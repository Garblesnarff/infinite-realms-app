import { afterAll, describe, expect, spyOn, test } from 'bun:test';

import { combatLogger } from '../../lib/logger.js';
import { assignEntitySlugs } from '../identity.js';
import {
  buildLegacyAttackHintPrompt,
  translateLegacyAttackRolls,
  weaponIdFromPurpose,
} from '../legacy-attack-translation.js';
import { buildTacticalPrompt } from '../prompt.js';

import type { DMResponse } from '../../services/dm/dm-response-schema.js';
import type { MapEntity, TacticalMap } from '../types.js';

/**
 * Run 8 reproduction. The model was corrected eleven times for writing attacks as
 * `roll_requests` and adopted `combat_actions` zero times; combat then stopped resolving at
 * all. These are its purposes, verbatim, and the assertion is that every one of them now
 * becomes an attack the engine can execute.
 */
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
    entity('shadow-roach-1', 'Shadow Roach', 6, 5, 'monster'),
    entity('shadow-roach-2', 'Shadow Roach', 10, 9, 'monster'),
  ];
  assignEntitySlugs(entities);
  return {
    id: 'map',
    sessionId: 'session',
    width: 14,
    height: 12,
    round: 1,
    sceneDescription: 'test',
    cells: Array.from({ length: 12 }, () =>
      Array.from({ length: 14 }, () => ({
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

const promptFor = (activeId: string, encounterId = 'enc-1'): string =>
  `<tactical_context>\n${buildTacticalPrompt(board(), activeId)}\n</tactical_context>\n` +
  `<immutable_game_state>{"isInCombat":true,"encounterId":"${encounterId}"}</immutable_game_state>`;

const attackRequest = (purpose: string) => ({
  type: 'attack' as const,
  formula: '1d20+4',
  purpose,
  dc: null,
  ac: 15,
  advantage: false,
  disadvantage: false,
});

const response = (overrides: Partial<DMResponse> = {}): DMResponse => ({
  text: 'Steel and chitin.',
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

describe("run 8's attack purposes are translated, not corrected", () => {
  test('"Attack roll against Shadow Roach 1" names its target outright', () => {
    const result = translateLegacyAttackRolls(
      response({ roll_requests: [attackRequest('Attack roll against Shadow Roach 1')] }),
      promptFor('the-seeker'),
      true,
    )!;
    expect(result.response.roll_requests).toHaveLength(0);
    expect(result.response.combat_actions).toEqual([
      {
        actor_id: 'the-seeker',
        action_type: 'attack',
        target_ids: ['shadow-roach-1'],
        weapon_id: null,
        spell_id: null,
        slot_level: null,
        movement_feet: 0,
      },
    ]);
  });

  test('"Attack roll with longsword against the first Shadow Roach" keeps its weapon', () => {
    const result = translateLegacyAttackRolls(
      response({
        roll_requests: [attackRequest('Attack roll with longsword against the first Shadow Roach')],
      }),
      promptFor('the-seeker'),
      true,
    )!;
    const action = result.response.combat_actions[0];
    expect(action).toMatchObject({
      actor_id: 'the-seeker',
      action_type: 'attack',
      weapon_id: 'longsword',
      movement_feet: 0,
    });
    // A shared display name resolves to the nearest candidate, and says so.
    expect('target_ids' in action && action.target_ids).toEqual(['shadow-roach-1']);
    expect(result.translations[0].fallbacks).toContain('nearest_hostile');
  });

  test('a monster attack phrased at "you" recovers both sides from the active turn', () => {
    const result = translateLegacyAttackRolls(
      response({ roll_requests: [attackRequest('The Shadow Roach lunges at you')] }),
      promptFor('shadow-roach-2'),
      true,
    )!;
    expect(result.response.combat_actions[0]).toMatchObject({
      actor_id: 'shadow-roach-2',
      action_type: 'attack',
      target_ids: ['the-seeker'],
    });
    expect(result.translations[0].fallbacks).toContain('assumed_target');
  });

  test('saves and checks are never touched', () => {
    const saves = response({
      roll_requests: [{ ...attackRequest('Dexterity save vs the pit'), type: 'save', dc: 14 }],
    });
    expect(translateLegacyAttackRolls(saves, promptFor('the-seeker'), true)).toBeNull();
  });

  test('an attack the model already declared properly is not duplicated', () => {
    const declared = {
      actor_id: 'the-seeker',
      action_type: 'attack' as const,
      target_ids: ['shadow-roach-1'],
      weapon_id: 'longsword',
      spell_id: null,
      slot_level: null,
      movement_feet: 0,
    };
    const result = translateLegacyAttackRolls(
      response({
        combat_actions: [declared],
        roll_requests: [attackRequest('Attack roll against Shadow Roach 1')],
      }),
      promptFor('the-seeker'),
      true,
    )!;
    expect(result.response.combat_actions).toEqual([declared]);
    // The redundant request still leaves roll_requests: it was an attack, not a check.
    expect(result.response.roll_requests).toHaveLength(0);
  });

  test('outside combat, and without a digest, nothing is translated', () => {
    const legacy = response({ roll_requests: [attackRequest('Attack roll against the bandit')] });
    expect(translateLegacyAttackRolls(legacy, promptFor('the-seeker'), false)).toBeNull();
    expect(translateLegacyAttackRolls(legacy, 'no tactical context here', true)).toBeNull();
  });

  test('a purpose naming nobody on the board is left where it is, not invented into an attack', () => {
    const result = translateLegacyAttackRolls(
      response({ roll_requests: [attackRequest('a strike at something unnamed')] }),
      promptFor('the-seeker'),
      true,
    );
    expect(result).toBeNull();
  });
});

describe('the teaching hint', () => {
  test('carries the live slugs from this turn, not placeholders', () => {
    const result = translateLegacyAttackRolls(
      response({ roll_requests: [attackRequest('Attack roll against Shadow Roach 1')] }),
      promptFor('the-seeker'),
      true,
    )!;
    const hint = buildLegacyAttackHintPrompt(result);
    expect(hint).toContain('"actor_id":"the-seeker"');
    expect(hint).toContain('"target_ids":["shadow-roach-1"]');
    expect(hint).toContain('"action_type":"attack"');
    expect(hint).not.toContain('<actor_id>');
    expect(hint).not.toContain('actor-id-here');
  });
});

describe('weapon inference', () => {
  test.each([
    ['Attack roll with longsword against the first Shadow Roach', 'longsword'],
    ['Attack roll with my heavy crossbow at Shadow Roach 2', 'heavy-crossbow'],
    ['Attack roll against Shadow Roach 1', null],
    ['The Storyteller punches Dishwasher Prime', 'unarmed-strike'],
    ['I attempt one final punch on Dishwasher prime', 'unarmed-strike'],
    ['kick the nearest living thing', 'unarmed-strike'],
  ])('%p yields %p', (purpose, expected) => {
    expect(weaponIdFromPurpose(purpose)).toBe(expected as string | null);
  });
});

describe('a spell attack is the spell it names, never a weapon attack (#2233)', () => {
  test('"Chill Touch spell attack vs Shadow Roach 1" becomes a Chill Touch cast', () => {
    const result = translateLegacyAttackRolls(
      response({
        roll_requests: [attackRequest('Chill Touch spell attack vs Shadow Roach 1')],
      }),
      promptFor('the-seeker'),
      true,
    )!;
    expect(result.response.roll_requests).toHaveLength(0);
    expect(result.response.combat_actions).toEqual([
      {
        actor_id: 'the-seeker',
        action_type: 'cast_spell',
        target_ids: ['shadow-roach-1'],
        weapon_id: null,
        spell_id: 'chill-touch',
        slot_level: null,
        movement_feet: 0,
      },
    ]);
  });

  test('a leveled spell carries its slot level', () => {
    const result = translateLegacyAttackRolls(
      response({
        roll_requests: [attackRequest('The Seeker casts Burning Hands at Shadow Roach 1')],
      }),
      promptFor('the-seeker'),
      true,
    )!;
    expect(result.response.combat_actions[0]).toMatchObject({
      action_type: 'cast_spell',
      spell_id: 'burning-hands',
      slot_level: 1,
    });
  });

  test('a spell attack naming no castable spell is left untranslated, not made an unarmed strike', () => {
    const result = translateLegacyAttackRolls(
      response({
        roll_requests: [attackRequest('Spell attack with a ghostly hand against Shadow Roach 1')],
      }),
      promptFor('the-seeker'),
      true,
    );
    expect(result).toBeNull();
  });
});

describe('an attack that produced no engine action says why (#2563, run D5)', () => {
  // Run D5 round 2: the DM declared the Scholar's quarterstaff attack on
  // Light-Eater Swarm 1 in `combat_actions` AND repeated it as an attack roll
  // request. The log read `translations: [], untranslated: []` — indistinguishable
  // from a translation that failed outright. Every skip now carries its reason.
  const d5Board = (): TacticalMap => {
    const entities = [
      entity('the-scholar', 'The Scholar', 4, 2, 'pc'),
      entity('light-eater-swarm-1', 'Light-Eater Swarm', 3, 3, 'monster'),
      entity('light-eater-swarm-2', 'Light-Eater Swarm', 5, 3, 'monster'),
    ];
    assignEntitySlugs(entities);
    return { ...board(), entities, round: 2 };
  };

  const d5Prompt = (): string =>
    `<tactical_context>\n${buildTacticalPrompt(d5Board(), 'the-scholar')}\n</tactical_context>\n` +
    `<immutable_game_state>{"isInCombat":true,"encounterId":"enc-d5"}</immutable_game_state>`;

  test('an attack already declared in combat_actions is skipped as already_declared, never duplicated', () => {
    const declared = {
      actor_id: 'the-scholar',
      action_type: 'attack' as const,
      target_ids: ['light-eater-swarm-1'],
      weapon_id: 'quarterstaff',
      spell_id: null,
      slot_level: null,
      movement_feet: 0,
    };
    const result = translateLegacyAttackRolls(
      response({
        combat_actions: [declared],
        roll_requests: [
          attackRequest('Attack roll with quarterstaff against Light-Eater Swarm 1'),
        ],
      }),
      d5Prompt(),
      true,
    )!;
    expect(result.translations).toEqual([]);
    expect(result.skipped).toEqual([
      { reason: 'already_declared', actorId: 'the-scholar', targetId: 'light-eater-swarm-1' },
    ]);
    // The declared attack stands exactly once, and the duplicate request is consumed.
    expect(result.response.combat_actions).toEqual([declared]);
    expect(result.response.roll_requests).toEqual([]);
  });

  test('a purpose naming nobody on the board is skipped as pair_unresolved beside a translated attack', () => {
    const result = translateLegacyAttackRolls(
      response({
        roll_requests: [
          attackRequest('Attack roll with quarterstaff against Light-Eater Swarm 1'),
          attackRequest('Attack roll against the Unseen Phantom'),
        ],
      }),
      d5Prompt(),
      true,
    )!;
    expect(result.translations).toHaveLength(1);
    expect(result.skipped).toEqual([{ reason: 'pair_unresolved' }]);
  });
});

describe('the not-translated lines carry the encounter id (#2563 review)', () => {
  const warnings: Array<Record<string, unknown>> = [];
  const warnSpy = spyOn(combatLogger, 'warn').mockImplementation(((
    entry: Record<string, unknown>,
  ) => {
    warnings.push(entry);
  }) as typeof combatLogger.warn);
  afterAll(() => warnSpy.mockRestore());

  test('a skipped attack logs DM_ATTACK_NOT_TRANSLATED with reason, ids and encounterId', () => {
    warnings.length = 0;
    translateLegacyAttackRolls(
      response({
        roll_requests: [attackRequest('Attack roll against the Unseen Phantom')],
      }),
      promptFor('the-seeker', 'enc-log-skip'),
      true,
    );
    const line = warnings.find((entry) => entry.msg === 'DM_ATTACK_NOT_TRANSLATED');
    expect(line).toMatchObject({
      reason: 'pair_unresolved',
      encounterId: 'enc-log-skip',
    });
  });

  test('the no-digest line carries the encounter id too', () => {
    warnings.length = 0;
    const prompt =
      `<immutable_game_state>{"isInCombat":true,"encounterId":"enc-log-nodigest"}</immutable_game_state>`;
    const result = translateLegacyAttackRolls(
      response({
        roll_requests: [attackRequest('Attack roll with quarterstaff against Light-Eater Swarm 1')],
      }),
      prompt,
      true,
    );
    expect(result).toBeNull();
    const line = warnings.find((entry) => entry.msg === 'DM_ATTACK_NOT_TRANSLATED');
    expect(line).toMatchObject({
      reason: 'no_digest',
      encounterId: 'enc-log-nodigest',
      requestCount: 1,
    });
  });
});
