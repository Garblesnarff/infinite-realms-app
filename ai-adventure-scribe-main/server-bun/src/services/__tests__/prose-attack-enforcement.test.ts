import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';

import { logger } from '../../lib/logger.js';
import { resetEncounterHints } from '../../tactical/encounter-hints.js';
import { assignEntitySlugs } from '../../tactical/identity.js';
import { buildTacticalPrompt } from '../../tactical/prompt.js';
import { enforceCombatTransitionContract } from '../combat-transition-enforcement.js';
import { LLMProviderService } from '../llm-provider-service.js';

import type { MapEntity, TacticalMap } from '../../tactical/types.js';
import type { DMResponse } from '../dm/dm-response-schema.js';

/**
 * Which layer catches the attack, at the seam the whole wave exists to defend.
 *
 * There are three channels now and they are strictly ordered: `combat_actions` the model wrote
 * itself, attack-shaped `roll_requests` the translator rewrites, and the prose floor. These
 * tests pin the ordering — every envelope arrives at the engine, and exactly one layer claims
 * each one, so an inference can never double an attack the model actually declared.
 */
const logs: Array<Record<string, unknown>> = [];

const generate = spyOn(LLMProviderService, 'generate');
const warn = spyOn(logger, 'warn').mockImplementation(((entry: Record<string, unknown>) => {
  logs.push(entry);
}) as typeof logger.warn);
const error = spyOn(logger, 'error').mockImplementation(((entry: Record<string, unknown>) => {
  logs.push(entry);
}) as typeof logger.error);
const info = spyOn(logger, 'info').mockImplementation(((entry: Record<string, unknown>) => {
  logs.push(entry);
}) as typeof logger.info);

const RUN_9_SEQ_12 =
  'You surge forward through the damp air, drawing your blade to meet the chitinous threat ' +
  'head-on. The nearest Shadow Roach skitters across the flagstones toward you, mandibles ' +
  'clicking in the dark.';

const entity = (id: string, name: string, x: number, y: number, type: 'pc' | 'monster') =>
  ({
    id,
    name,
    x,
    y,
    size: 'medium',
    type,
    speedFeet: 30,
    movementRemaining: 30,
  }) satisfies MapEntity;

/** The hostiles on the board; the default is one Shadow Roach, as in the run 9 reproduction. */
type Hostile = [id: string, name: string, x: number, y: number];
const SINGLE_ROACH: Hostile[] = [['shadow-roach', 'Shadow Roach', 6, 5]];

const board = (hostiles: Hostile[] = SINGLE_ROACH): TacticalMap => {
  const entities = [
    entity('the-seeker', 'The Seeker', 1, 1, 'pc'),
    ...hostiles.map(([id, name, x, y]) => entity(id, name, x, y, 'monster')),
  ];
  assignEntitySlugs(entities);
  return {
    id: 'map',
    sessionId: 'session',
    width: 12,
    height: 10,
    round: 1,
    sceneDescription: 'test',
    cells: Array.from({ length: 10 }, () =>
      Array.from({ length: 12 }, () => ({
        terrain: 'floor' as const,
        blocksMovement: false,
        blocksSight: false,
        cover: 0 as const,
        elevation: 0,
      })),
    ),
    entities,
  };
};

const promptFor = (
  encounterId: string,
  playerInput?: string,
  hostiles: Hostile[] = SINGLE_ROACH,
): string =>
  `<tactical_context>\n${buildTacticalPrompt(board(hostiles), 'the-seeker')}\n</tactical_context>\n` +
  `<immutable_game_state>{"isInCombat":true,"encounterId":"${encounterId}"}</immutable_game_state>` +
  (playerInput === undefined ? '' : `\n<player_input>\n${playerInput}\n</player_input>`);

const dmResponse = (overrides: Partial<DMResponse>): string =>
  JSON.stringify({
    text: RUN_9_SEQ_12,
    narration_segments: [],
    roll_requests: [],
    combat_transition: 'none',
    scene_spec: null,
    map_actions: [],
    handout_actions: [],
    combatants: [],
    combat_actions: [],
    ...overrides,
  });

const enforce = (
  text: string,
  encounterId: string,
  playerInput?: string,
  hostiles: Hostile[] = SINGLE_ROACH,
) =>
  enforceCombatTransitionContract({
    result: { text, provider: 'openrouter' },
    prompt: promptFor(encounterId, playerInput, hostiles),
    ...(playerInput === undefined ? {} : { playerInput }),
    maxTokens: 4000,
    temperature: 0.9,
    provider: 'openrouter',
    responseSchema: { properties: { combat_transition: {}, roll_requests: {} } },
  });

const attackFromResult = (text: string) => {
  const parsed = JSON.parse(text) as DMResponse;
  return parsed.combat_actions.filter(
    (action) => 'target_ids' in action && action.action_type === 'attack',
  );
};

const declaredActionsFrom = (text: string) => {
  const parsed = JSON.parse(text) as DMResponse;
  return parsed.combat_actions.filter(
    (action) =>
      'target_ids' in action &&
      (action.action_type === 'attack' || action.action_type === 'cast_spell'),
  );
};

const firedLayers = () => ({
  dialect: logs.some((entry) => entry.msg === 'DM_LEGACY_ATTACK_TRANSLATED'),
  prose: logs.some((entry) => entry.msg === 'DM_PROSE_ATTACK_INFERRED'),
});

beforeEach(() => {
  generate.mockClear();
  generate.mockImplementation(async () => ({ text: '', provider: 'openrouter' as const }));
  logs.length = 0;
  resetEncounterHints();
});

afterAll(() => {
  generate.mockRestore();
  warn.mockRestore();
  error.mockRestore();
  info.mockRestore();
});

describe('run 9: prose-only combat now reaches the engine', () => {
  test('the pinned paragraph, declaring nothing, is delivered as a combat_action', async () => {
    const result = await enforce(dmResponse({}), 'enc-prose');
    expect(attackFromResult(result.text)).toEqual([
      {
        actor_id: 'the-seeker',
        action_type: 'attack',
        target_ids: ['shadow-roach'],
        weapon_id: 'blade',
        spell_id: null,
        slot_level: null,
        movement_feet: 0,
      },
    ]);
  });

  test('the prose floor is the layer that fires, and it is alerted on', async () => {
    await enforce(dmResponse({}), 'enc-which-prose');
    expect(firedLayers()).toEqual({ dialect: false, prose: true });
    const alert = logs.find((entry) => entry.msg === 'DM_PROSE_ATTACK_INFERRED')!;
    expect(alert.alert).toBe(true);
    expect(alert.actorId).toBe('the-seeker');
    expect(alert.targetId).toBe('shadow-roach');
  });

  test('an inferred attack is never argued with: no corrective re-prompt is spent on it', async () => {
    await enforce(dmResponse({}), 'enc-no-argument');
    expect(generate).not.toHaveBeenCalled();
  });
});

/**
 * Run D9 (#2641): the player typed "I hold my position and end my turn without attacking" and the
 * DM's narration described the monsters pressing the fight, with a crossbow in it. The floor read
 * the monsters' prose as the player's swing and the client opened an attack prompt, weapon
 * "Crossbow, light", for a turn in which the player attacked nothing.
 */
describe("the prose floor reads an attack the player declared, not the monsters' turn (#2641)", () => {
  const monsterTurnProse = dmResponse({
    text:
      'The Shadow Roach lunges at you, mandibles snapping, as a crossbow bolt skitters across ' +
      'the flagstones and the roaches press their attack.',
  });
  const inputFor = (input: string, attempt: string) =>
    enforce(monsterTurnProse, `enc-d9-${attempt}-${input.length}`, input);

  test.each([
    ['holding position', 'I hold my position and end my turn without attacking.'],
    ['ending the turn', 'I end my turn without taking any action.'],
    [
      'standing ground',
      'I plant my feet and stand my ground, taking no offensive action this turn.',
    ],
    ['a refused strike', 'I do not attack, I raise my shield.'],
    ['a contraction', "I don't attack. I stand my ground with my sword raised."],
    ['looking around', 'I look around the room.'],
    ['talking', 'I ask the Shadow Roach its name.'],
    ['checking the pack', 'I check my pack.'],
    ['bracing for their attacks', "I brace for the roaches' attacks, keeping my shield raised."],
  ])('%s declares no attack, so none is made up for the player', async (_name, input) => {
    const result = await inputFor(input, 'none');
    expect(attackFromResult(result.text)).toEqual([]);
    expect(firedLayers().prose).toBe(false);
  });

  test.each([
    ['a swing', 'I swing my longsword at the Shadow Roach.'],
    ['a verb outside the prose list', 'I hit the Shadow Roach.'],
    ['a spell typed without "cast"', 'I use Sacred Flame on the Shadow Roach.'],
    [
      'a refusal that is not a decline',
      'Without hesitating, I use Sacred Flame on the Shadow Roach.',
    ],
    ['a wait before the strike', 'I wait for it to close, then finish it off.'],
    ['a verb no list holds', 'I finish it off.'],
    ['an attack beside a pass', 'I attack the Shadow Roach and then end my turn.'],
    ['the continuation of an attack roll', 'Attack roll: 15 (nat 10+5) hit'],
  ])('%s still reaches the engine through the floor', async (_name, input) => {
    const result = await inputFor(input, 'attack');
    expect(declaredActionsFrom(result.text)).toHaveLength(1);
    expect(firedLayers().prose).toBe(true);
  });

  test('a swing that names no weapon declares none, never the crossbow from the narration', async () => {
    const result = await inputFor('I swing at the Shadow Roach.', 'noweapon');
    expect(attackFromResult(result.text)).toEqual([
      expect.objectContaining({ weapon_id: null, target_ids: ['shadow-roach'] }),
    ]);
  });

  test('the weapon is the one the player named', async () => {
    const result = await inputFor('I swing my longsword at the Shadow Roach.', 'named');
    expect(attackFromResult(result.text)).toEqual([
      expect.objectContaining({ weapon_id: 'longsword' }),
    ]);
  });

  test('a swing, then a non-attack turn on the same narration: no second prompt', async () => {
    // The loop in D9: the player dismissed the prompt, and the next turn's monster narration made
    // another. The producer is what re-fired, so the second turn must declare nothing.
    const first = await inputFor('I swing at the Shadow Roach.', 'loop-1');
    expect(attackFromResult(first.text)).toHaveLength(1);
    const second = await inputFor('I look around the room.', 'loop-2');
    expect(attackFromResult(second.text)).toEqual([]);
  });

  test('a turn with no player input keeps the narration floor as it was', async () => {
    const result = await enforce(monsterTurnProse, 'enc-d9-no-input');
    expect(attackFromResult(result.text)).toHaveLength(1);
  });
});

/**
 * The reader takes the player's AFFIRMED clauses only (#2641): what they refused, what they merely
 * dodge or walk toward, and what someone else does to them are not a swing.
 */
describe('the prose floor reads what the player affirmed (#2641)', () => {
  const monsterTurnProse = dmResponse({
    text: 'The Zombie lunges at you and the Silent Monk raises a crossbow, bolt gleaming.',
  });
  // Two different creatures, so the target the player names is observable.
  const TWO_CREATURES: Hostile[] = [
    ['zombie', 'Zombie', 5, 1],
    ['silent-monk', 'Silent Monk', 1, 6],
  ];
  const turn = (input: string, hostiles: Hostile[] = TWO_CREATURES) =>
    enforce(monsterTurnProse, `enc-affirm-${input.length}-${hostiles.length}`, input, hostiles);

  test.each([
    ['attack then refuse', 'I attack the Zombie, not the Silent Monk.', 'zombie'],
    [
      'attack then a refused attack',
      "I attack the Zombie, don't attack the Silent Monk.",
      'zombie',
    ],
    ['refuse then attack', "Don't attack the Zombie, attack the Silent Monk.", 'silent-monk'],
    ['refuse then attack, other order', 'Not the Zombie, I attack the Silent Monk.', 'silent-monk'],
  ])('%s: the target is the creature the player attacks', async (_name, input, target) => {
    const result = await turn(input);
    expect(attackFromResult(result.text)).toEqual([
      expect.objectContaining({ target_ids: [target] }),
    ]);
  });

  test('a refused spell is not declared: "I don\'t cast Sacred Flame, I swing my sword"', async () => {
    const result = await turn("I don't cast Sacred Flame, I swing my sword at the Zombie.");
    expect(declaredActionsFrom(result.text)).toEqual([
      expect.objectContaining({ action_type: 'attack', weapon_id: 'sword' }),
    ]);
  });

  test('a refused weapon is not declared: "I don\'t use my longbow, I swing my sword"', async () => {
    const result = await turn("I don't use my longbow, I swing my sword at the Zombie.");
    expect(attackFromResult(result.text)).toEqual([
      expect.objectContaining({ weapon_id: 'sword' }),
    ]);
  });

  test.each([
    'I dodge their attack.',
    'I brace for their attack.',
    'I raise my shield to block the hit.',
    'I try not to get hit.',
    'I get hit by the Zombie.',
    'I rush to the door and shut it.',
    'I charge toward the stairs.',
    'I throw the rope across the gap.',
    'I fire up the torch.',
    'I shove the barrel aside.',
    'The Zombie attacks me.',
  ])('defensive, movement or passive phrasing is not an attack: %s', async (input) => {
    const result = await turn(input);
    expect(declaredActionsFrom(result.text)).toEqual([]);
    expect(firedLayers().prose).toBe(false);
  });

  test.each([
    'I choose not to attack.',
    'I decide not to attack, I raise my shield.',
    "I can't attack.",
    'I cannot attack the Zombie.',
    'I never attack.',
    "I'd rather not attack.",
    'I make no attack this turn.',
    'I refuse to attack.',
    'I decline to attack.',
  ])('a refusal is not an attack: %s', async (input) => {
    const result = await turn(input);
    expect(declaredActionsFrom(result.text)).toEqual([]);
  });

  test.each([
    ['a counted attack', 'I make two attacks on the Zombie.'],
    ['a gerund opening', 'Attacking the Zombie.'],
    ['a progressive', "I'm hitting it."],
    ['a driven axe', 'I drive my axe into it.'],
    ['a brought-down axe', 'I bring my axe down on the Zombie.'],
    ['striking', 'I am striking the Zombie.'],
    ['swinging', 'Swinging my sword at the Zombie.'],
    ['a charge with a creature', 'I charge the Zombie.'],
    ['a thrown weapon', 'I throw my javelin at the Silent Monk.'],
    ['a fired crossbow', 'I fire my crossbow at the Silent Monk.'],
    ['an impale', 'I impale the Zombie.'],
  ])('%s still reaches the engine', async (_name, input) => {
    const result = await turn(input);
    expect(declaredActionsFrom(result.text)).toHaveLength(1);
  });

  // Two creatures with one name are slugged in board order: the far roach is `shadow-roach-1`,
  // the near one `shadow-roach-2`.
  test('no creature named: the nearest hostile is the target', async () => {
    const result = await turn('I finish it off.', [
      ['far-roach', 'Shadow Roach', 9, 9],
      ['near-roach', 'Shadow Roach', 3, 1],
    ]);
    expect(attackFromResult(result.text)).toEqual([
      expect.objectContaining({ target_ids: ['shadow-roach-2'] }),
    ]);
  });

  test('no creature named and two hostiles equally near: nothing is declared', async () => {
    const result = await turn('I finish it off.', [
      ['east-roach', 'Shadow Roach', 5, 1],
      ['south-roach', 'Shadow Roach', 1, 5],
    ]);
    expect(declaredActionsFrom(result.text)).toEqual([]);
    expect(firedLayers().prose).toBe(false);
  });

  test('a shared name with equally near creatures: nothing is declared', async () => {
    const result = await turn('I attack the Shadow Roach.', [
      ['east-roach', 'Shadow Roach', 5, 1],
      ['south-roach', 'Shadow Roach', 1, 5],
    ]);
    expect(declaredActionsFrom(result.text)).toEqual([]);
  });

  test('a shared name with creatures at different distances picks the nearest', async () => {
    const result = await turn('I attack the Shadow Roach.', [
      ['far-roach', 'Shadow Roach', 9, 9],
      ['near-roach', 'Shadow Roach', 3, 1],
    ]);
    expect(attackFromResult(result.text)).toEqual([
      expect.objectContaining({ target_ids: ['shadow-roach-2'] }),
    ]);
  });
});

describe('the re-taught dialect is the layer that fires when the model speaks it', () => {
  const taughtDialect = dmResponse({
    roll_requests: [
      {
        type: 'attack',
        formula: '1d20',
        purpose: 'the-seeker attacks shadow-roach with longsword',
        dc: null,
        ac: null,
        advantage: false,
        disadvantage: false,
      },
    ],
  });

  test('the envelope taught by the prompt translates, resolves, and empties roll_requests', async () => {
    generate.mockImplementation(async () => ({ text: taughtDialect, provider: 'openrouter' }));
    await enforce(taughtDialect, 'enc-dialect');
    // Second pass: the one-per-encounter hint is spent, so this is the silent steady state.
    const result = await enforce(taughtDialect, 'enc-dialect');
    const parsed = JSON.parse(result.text) as DMResponse;
    expect(parsed.roll_requests).toHaveLength(0);
    expect(attackFromResult(result.text)).toEqual([
      {
        actor_id: 'the-seeker',
        action_type: 'attack',
        target_ids: ['shadow-roach'],
        weapon_id: 'longsword',
        spell_id: null,
        slot_level: null,
        movement_feet: 0,
      },
    ]);
  });

  test('the dialect layer fires and the prose floor stays silent', async () => {
    generate.mockImplementation(async () => ({ text: taughtDialect, provider: 'openrouter' }));
    await enforce(taughtDialect, 'enc-which-dialect');
    expect(firedLayers()).toEqual({ dialect: true, prose: false });
  });

  /**
   * The narration and the declaration describe the same swing. If the floor read the prose as
   * well, the roach would be hit twice for one attack — which is why the floor only ever runs
   * on a response that declared nothing.
   */
  test('a turn that both narrates and declares produces exactly one attack', async () => {
    generate.mockImplementation(async () => ({ text: taughtDialect, provider: 'openrouter' }));
    await enforce(taughtDialect, 'enc-once');
    const result = await enforce(taughtDialect, 'enc-once');
    expect(attackFromResult(result.text)).toHaveLength(1);
  });
});

describe('a model that already speaks combat_actions is left entirely alone', () => {
  const declared = dmResponse({
    combat_actions: [
      {
        actor_id: 'the-seeker',
        action_type: 'attack',
        target_ids: ['shadow-roach'],
        weapon_id: 'longsword',
        spell_id: null,
        slot_level: null,
        movement_feet: 0,
      },
    ],
  });

  test('neither layer fires and the response is passed through unchanged', async () => {
    const result = await enforce(declared, 'enc-native');
    expect(firedLayers()).toEqual({ dialect: false, prose: false });
    expect(result.text).toBe(declared);
    expect(attackFromResult(result.text)).toHaveLength(1);
  });
});
