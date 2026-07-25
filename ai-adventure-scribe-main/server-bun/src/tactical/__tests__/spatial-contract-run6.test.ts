import { describe, expect, test } from 'bun:test';

import { parseTacticalDigest } from '../digest-parse.js';
import { assignEntitySlugs } from '../identity.js';
import { buildTacticalPrompt } from '../prompt.js';
import {
  buildSpatialCorrectivePrompt,
  validateSpatialCombatContract,
} from '../spatial-contract.js';

import type { DMResponse } from '../../services/dm/dm-response-schema.js';
import type { MapEntity, TacticalMap } from '../types.js';

/**
 * Run 6 reproduction. The board keys entities by UUID, the DM addresses them by slug, and the
 * turn is served through the per-entity context route. Under those exact conditions the
 * spatial contract fired zero times across thirty turns while melee was narrated at 55ft.
 *
 * Two independent defects produced that silence and both are pinned here: the identity
 * mismatch between slugs and UUIDs, and the per-entity digest that shipped a one-entity board
 * the validator could never resolve an attack target against.
 */
const SEEKER_UUID = '3f1c9a72-8d4b-4c21-9e77-2b6f0a5d1e33';
const ROACH_UUID = 'a71e4d05-6c92-4f18-b3aa-90e7c2418d64';

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
  // 11 cells of Chebyshev separation is exactly the 55ft the DM narrated melee across.
  const entities = [
    entity(SEEKER_UUID, 'The Seeker', 1, 1, 'pc'),
    entity(ROACH_UUID, 'Shadow Roach', 12, 10, 'monster'),
  ];
  assignEntitySlugs(entities);
  return {
    id: 'map',
    sessionId: 'session',
    width: 16,
    height: 14,
    round: 1,
    sceneDescription: 'test',
    cells: Array.from({ length: 14 }, () =>
      Array.from({ length: 16 }, () => ({
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

/** The prompt exactly as the `/tactical-map/context/:entityId` route builds it, mid-turn. */
const turnPrompt = (map: TacticalMap, activeEntityId = ROACH_UUID): string =>
  `<tactical_context>\n${buildTacticalPrompt(map, activeEntityId)}\n</tactical_context>\n` +
  '<immutable_game_state>{"isInCombat":true}</immutable_game_state>';

const response = (overrides: Partial<DMResponse> = {}): DMResponse => ({
  text: 'The Shadow Roach skitters and bites at the Seeker.',
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

const meleeRollRequest = (purpose: string) => ({
  type: 'attack' as const,
  formula: '1d20+4',
  purpose,
  dc: null,
  ac: 15,
  advantage: false,
  disadvantage: false,
});

describe('run 6: spatial contract on a slug-addressed, UUID-keyed board', () => {
  test('the per-turn digest carries the whole board, not just the active entity', () => {
    const digest = parseTacticalDigest(turnPrompt(board()))!;
    expect([...digest.entities.keys()].sort()).toEqual(['shadow-roach', 'the-seeker']);
    // Whose turn it is survives as its own line rather than by truncating the board.
    expect(turnPrompt(board())).toContain('ACTIVE shadow-roach');
  });

  test('a melee attack roll_request at 55ft produces the corrective citing the real distance', () => {
    const violation = validateSpatialCombatContract(
      response({ roll_requests: [meleeRollRequest('shadow-roach bites the-seeker')] }),
      turnPrompt(board()),
      true,
    );
    expect(violation).toMatchObject({
      kind: 'melee_out_of_reach',
      actorId: 'shadow-roach',
      targetId: 'the-seeker',
      distanceFeet: 55,
      movementRemaining: 30,
    });
    expect(violation!.message).toBe(
      'Shadow Roach is 55ft from The Seeker; melee requires 5ft; you have 30ft movement.',
    );
    expect(buildSpatialCorrectivePrompt(violation!)).toContain('"shadow-roach"');
  });

  test.each([
    'shadow-roach claws at the-seeker',
    'Shadow_Roach attacks Seeker',
    'SHADOW ROACH bites The Seeker',
  ])('the actor/target pair survives the spelling %p', (purpose) => {
    expect(
      validateSpatialCombatContract(
        response({ roll_requests: [meleeRollRequest(purpose)] }),
        turnPrompt(board()),
        true,
      ),
    ).toMatchObject({ actorId: 'shadow-roach', targetId: 'the-seeker', distanceFeet: 55 });
  });

  test('a slug-addressed combat_action at 55ft is caught the same way', () => {
    expect(
      validateSpatialCombatContract(
        response({
          combat_actions: [
            {
              actor_id: 'shadow_roach',
              action_type: 'attack',
              target_ids: ['seeker'],
              weapon_id: null,
              spell_id: null,
              slot_level: null,
              movement_feet: 0,
            },
          ],
        }),
        turnPrompt(board()),
        true,
      ),
    ).toMatchObject({ kind: 'melee_out_of_reach', distanceFeet: 55 });
  });

  test('a slug-addressed move that actually closes the gap clears the violation', () => {
    // Underscores in the move, hyphens in the attack: the same entity either way.
    expect(
      validateSpatialCombatContract(
        response({
          map_actions: [{ action: 'move', entityId: 'shadow_roach', x: 2, y: 2, changes: null }],
          combat_actions: [
            {
              actor_id: 'shadow-roach',
              action_type: 'attack',
              target_ids: ['the-seeker'],
              weapon_id: null,
              spell_id: null,
              slot_level: null,
              movement_feet: 30,
            },
          ],
        }),
        turnPrompt(board()),
        true,
      ),
    ).toBeNull();
  });

  test('a move that stops short of reach is still a violation', () => {
    expect(
      validateSpatialCombatContract(
        response({
          map_actions: [{ action: 'move', entityId: 'shadow-roach', x: 6, y: 6, changes: null }],
          roll_requests: [meleeRollRequest('shadow-roach bites the-seeker')],
        }),
        turnPrompt(board()),
        true,
      ),
    ).toMatchObject({ kind: 'melee_out_of_reach' });
  });

  test('the specific roach keeps its mention when two share a display name', () => {
    const map = board();
    map.entities = [
      map.entities[0],
      { ...map.entities[1], id: ROACH_UUID, slug: undefined },
      {
        ...map.entities[1],
        id: 'e6d1b2a4-45cf-4f07-9a83-1c0d7be95f28',
        slug: undefined,
        x: 12,
        y: 8,
      },
    ];
    assignEntitySlugs(map.entities);
    const violation = validateSpatialCombatContract(
      response({ roll_requests: [meleeRollRequest('shadow-roach-2 lunges at the-seeker')] }),
      turnPrompt(map),
      true,
    );
    expect(violation?.actorId).toBe('shadow-roach-2');
  });
});
