import { describe, expect, test } from 'bun:test';

import { parseTacticalDigest } from '../digest-parse.js';
import { buildTacticalPrompt } from '../prompt.js';
import { MELEE_REACH_FEET, validateSpatialCombatContract } from '../spatial-contract.js';

import type { DMResponse } from '../../services/dm/dm-response-schema.js';
import type { TacticalMap } from '../types.js';

const board = (options: { wall?: boolean } = {}): TacticalMap => {
  const map: TacticalMap = {
    id: 'map',
    sessionId: 'session',
    width: 10,
    height: 10,
    round: 1,
    sceneDescription: 'test',
    cells: Array.from({ length: 10 }, () =>
      Array.from({ length: 10 }, () => ({
        terrain: 'floor' as const,
        blocksMovement: false,
        blocksSight: false,
        cover: 0 as const,
        elevation: 0,
      })),
    ),
    entities: [
      {
        id: 'seeker',
        name: 'The Seeker',
        x: 1,
        y: 1,
        size: 'medium',
        type: 'pc',
        speedFeet: 30,
        movementRemaining: 30,
      },
      {
        id: 'void-maw',
        name: 'Void-Maw',
        x: 7,
        y: 7,
        size: 'medium',
        type: 'monster',
        speedFeet: 30,
        movementRemaining: 30,
      },
    ],
  };
  if (options.wall)
    for (let y = 0; y < 10; y += 1) {
      map.cells[y][4] = {
        ...map.cells[y][4],
        terrain: 'wall',
        blocksMovement: true,
        blocksSight: true,
      };
    }
  return map;
};

const promptFor = (map: TacticalMap): string =>
  `<tactical_context>\n${buildTacticalPrompt(map)}\n</tactical_context>\n<immutable_game_state>{"isInCombat":true}</immutable_game_state>`;

const response = (overrides: Partial<DMResponse> = {}): DMResponse => ({
  text: 'Void-Maw lunges.',
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

/** The same melee attack the DM writes in the old dialect: a roll request, no actor field. */
const meleeAttackRequest = () => ({
  type: 'attack' as const,
  formula: '1d20+4',
  purpose: "Void-Maw's claw against The Seeker",
  dc: null,
  ac: 15,
  advantage: false,
  disadvantage: false,
});

const meleeAttack = (movementFeet = 0) => ({
  actor_id: 'void-maw',
  action_type: 'attack' as const,
  target_ids: ['seeker'],
  weapon_id: null,
  spell_id: null,
  slot_level: null,
  movement_feet: movementFeet,
});

describe('spatial combat contract', () => {
  test('parses ids, names, positions, and engine geometry out of the digest', () => {
    const digest = parseTacticalDigest(promptFor(board()));
    expect(digest).not.toBeNull();
    const voidMaw = digest!.entities.get('void-maw')!;
    expect(voidMaw.name).toBe('Void-Maw');
    expect(voidMaw).toMatchObject({ x: 7, y: 7, movementRemaining: 30, speedFeet: 30 });
    expect(voidMaw.relations.get('seeker')).toMatchObject({
      distanceFeet: 30,
      hasLineOfSight: true,
    });
    expect(digest!.aliases.get('the seeker')).toBe('seeker');
  });

  // An attack in combat_actions reaches the engine, which walks the attacker into reach
  // itself before rolling. Correcting the model for a gap the engine closes is how run 8
  // spent every turn arguing instead of resolving.
  test('a melee combat_action at 30ft is left to the engine to approach', () => {
    expect(
      validateSpatialCombatContract(
        response({ combat_actions: [meleeAttack()] }),
        promptFor(board()),
        true,
      ),
    ).toBeNull();
  });

  test('a melee attack roll_request at 30ft is still a violation that cites the real distance', () => {
    const violation = validateSpatialCombatContract(
      response({
        roll_requests: [meleeAttackRequest()],
      }),
      promptFor(board()),
      true,
    );
    expect(violation?.kind).toBe('melee_out_of_reach');
    expect(violation?.message).toBe(
      'Void-Maw is 30ft from The Seeker; melee requires 5ft; you have 30ft movement.',
    );
  });

  test('a melee attack roll_request is paired from its purpose text', () => {
    const violation = validateSpatialCombatContract(
      response({
        roll_requests: [meleeAttackRequest()],
      }),
      promptFor(board()),
      true,
    );
    expect(violation).toMatchObject({ actorId: 'void-maw', targetId: 'seeker', distanceFeet: 30 });
  });

  test('a move that closes to reach in the same turn is accepted', () => {
    const violation = validateSpatialCombatContract(
      response({
        map_actions: [{ action: 'move', entityId: 'void-maw', x: 2, y: 2, changes: null }],
        combat_actions: [meleeAttack(25)],
      }),
      promptFor(board()),
      true,
    );
    expect(violation).toBeNull();
  });

  test('a move that still ends out of reach remains a violation for a roll_request attack', () => {
    const violation = validateSpatialCombatContract(
      response({
        map_actions: [{ action: 'move', entityId: 'void-maw', x: 5, y: 5, changes: null }],
        roll_requests: [meleeAttackRequest()],
      }),
      promptFor(board()),
      true,
    );
    expect(violation?.kind).toBe('melee_out_of_reach');
  });

  test('an adjacent melee attack is legal', () => {
    const map = board();
    map.entities[1].x = 2;
    map.entities[1].y = 1;
    expect(
      validateSpatialCombatContract(
        response({ combat_actions: [meleeAttack()] }),
        promptFor(map),
        true,
      ),
    ).toBeNull();
    expect(MELEE_REACH_FEET).toBe(5);
  });

  test('a ranged attack without line of sight is a violation, with it is not', () => {
    const walled = board({ wall: true });
    const rangedAttack = { ...meleeAttack(), weapon_id: 'longbow' };
    expect(
      validateSpatialCombatContract(
        response({ combat_actions: [rangedAttack] }),
        promptFor(walled),
        true,
      )?.kind,
    ).toBe('ranged_without_line_of_sight');
    expect(
      validateSpatialCombatContract(
        response({ combat_actions: [rangedAttack] }),
        promptFor(board()),
        true,
      ),
    ).toBeNull();
  });

  test('nothing is enforced outside combat or without a digest', () => {
    const attacking = response({ combat_actions: [meleeAttack()] });
    expect(validateSpatialCombatContract(attacking, promptFor(board()), false)).toBeNull();
    expect(validateSpatialCombatContract(attacking, 'no tactical context here', true)).toBeNull();
  });
});
