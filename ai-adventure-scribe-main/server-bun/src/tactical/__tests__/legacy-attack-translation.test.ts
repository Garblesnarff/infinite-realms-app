import { describe, expect, test } from 'bun:test';

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
  ])('%p yields %p', (purpose, expected) => {
    expect(weaponIdFromPurpose(purpose)).toBe(expected as string | null);
  });
});
