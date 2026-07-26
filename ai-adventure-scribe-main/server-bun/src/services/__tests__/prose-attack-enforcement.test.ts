import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { resetEncounterHints } from '../../tactical/encounter-hints.js';
import { assignEntitySlugs } from '../../tactical/identity.js';
import { buildTacticalPrompt } from '../../tactical/prompt.js';

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
type GenerateArgs = { prompt: string };
const generate = mock(async (_params: GenerateArgs) => ({
  text: '',
  provider: 'openrouter' as const,
}));
const logs: Array<Record<string, unknown>> = [];

mock.module('../llm-provider-service.js', () => ({ LLMProviderService: { generate } }));
mock.module('../../lib/logger.js', () => ({
  logger: {
    warn: (entry: Record<string, unknown>) => logs.push(entry),
    error: (entry: Record<string, unknown>) => logs.push(entry),
    info: (entry: Record<string, unknown>) => logs.push(entry),
    debug: () => undefined,
    child: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
  },
  combatLogger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));

const { enforceCombatTransitionContract } = await import('../combat-transition-enforcement.js');

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

const board = (): TacticalMap => {
  const entities = [
    entity('the-seeker', 'The Seeker', 1, 1, 'pc'),
    entity('shadow-roach', 'Shadow Roach', 6, 5, 'monster'),
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

const promptFor = (encounterId: string): string =>
  `<tactical_context>\n${buildTacticalPrompt(board(), 'the-seeker')}\n</tactical_context>\n` +
  `<immutable_game_state>{"isInCombat":true,"encounterId":"${encounterId}"}</immutable_game_state>`;

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

const enforce = (text: string, encounterId: string) =>
  enforceCombatTransitionContract({
    result: { text, provider: 'openrouter' },
    prompt: promptFor(encounterId),
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
