import { beforeEach, describe, expect, mock, test } from 'bun:test';

import type { TacticalMap } from '../../../tactical/types.js';

/**
 * Auto-approach at the service boundary: the engine has to actually move the entity on the
 * stored board and publish the move, not merely compute that it could.
 *
 * Run 7's board looked exactly like this — a roach 25ft from the party's front line, another
 * 45ft back — and thirty turns of narrated melee produced no movement of any kind.
 */
const SESSION_ID = '11111111-2222-4333-8444-555555555555';

const buildMap = (): TacticalMap => ({
  id: 'map-1',
  sessionId: SESSION_ID,
  width: 20,
  height: 20,
  round: 1,
  sceneDescription: 'cave',
  cells: Array.from({ length: 20 }, () =>
    Array.from({ length: 20 }, () => ({
      terrain: 'floor' as const,
      blocksMovement: false,
      blocksSight: false,
      cover: 0 as const,
      elevation: 0,
    })),
  ),
  entities: [
    {
      id: 'the-seeker',
      name: 'The Seeker',
      x: 1,
      y: 1,
      size: 'medium',
      type: 'pc',
      speedFeet: 30,
      movementRemaining: 30,
    },
    {
      // 5 cells away: 25ft, closeable inside a 30ft move.
      id: 'shadow-roach-1',
      name: 'Shadow Roach',
      x: 6,
      y: 1,
      size: 'medium',
      type: 'monster',
      speedFeet: 30,
      movementRemaining: 30,
    },
    {
      // 12 cells away: 60ft, not closeable this turn at any speed it has.
      id: 'shadow-roach-2',
      name: 'Shadow Roach',
      x: 13,
      y: 1,
      size: 'medium',
      type: 'monster',
      speedFeet: 30,
      movementRemaining: 30,
    },
  ],
});

let activeMap: TacticalMap = buildMap();
const broadcasts: Array<Record<string, unknown>> = [];
const approachWarnings: Array<Record<string, unknown>> = [];

mock.module('../tactical-map-store.js', () => ({
  loadActiveTacticalMap: async () => activeMap,
  // Engine-resolved facts are written to the session's LATEST map row rather than its active
  // one, so that a fact recorded on a killing blow survives the board being torn down. The
  // stub has to model that or `recordDmTacticalFact` silently writes nowhere.
  loadLatestTacticalMapRow: async () =>
    activeMap ? { rowId: 'row', state: activeMap, active: true } : null,
  saveTacticalMap: async (map: TacticalMap) => {
    activeMap = map;
  },
  saveTacticalMapRow: async (_rowId: string, state: TacticalMap) => {
    activeMap = state;
  },
  deactivateTacticalMap: async () => {},
}));
mock.module('../../collaboration/room-manager.js', () => ({
  broadcastToRoom: (_sessionId: string, _sender: unknown, payload: Record<string, unknown>) => {
    broadcasts.push(payload);
  },
}));
mock.module('../../../lib/logger.js', () => ({
  logger: {
    debug: () => {},
    info: () => {},
    warn: (payload: Record<string, unknown>) => {
      approachWarnings.push(payload);
    },
    error: () => {},
    child: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
  },
  combatLogger: {
    debug: () => {},
    info: () => {},
    warn: (payload: Record<string, unknown>) => {
      approachWarnings.push(payload);
    },
    error: () => {},
  },
}));

const { approachForAttack, decideAttackApproach, describeUnreachableApproach } =
  await import('../combat-approach-service.js');
const { resolveAttackRules } = await import('../combat-rules.js');
const { getDistance } = await import('../../../tactical/engine.js');

const entityOf = (id: string) => activeMap.entities.find((entity) => entity.id === id)!;

beforeEach(() => {
  activeMap = buildMap();
  broadcasts.length = 0;
  approachWarnings.length = 0;
});

describe('approachForAttack', () => {
  test('a one-step approach at 10ft moves 5ft into melee range', async () => {
    activeMap.entities[1] = { ...activeMap.entities[1], x: 3, y: 1 };

    const result = await approachForAttack(SESSION_ID, 'shadow-roach-1', 'the-seeker', 5);

    expect(result).toMatchObject({ kind: 'approached', distanceFeet: 5, movedFeet: 5 });
    expect(entityOf('shadow-roach-1').movementRemaining).toBe(25);
    expect(getDistance(entityOf('shadow-roach-1'), entityOf('the-seeker'))).toBe(5);
  });

  test('a 15ft approach moves into range so the caller can make one attack roll', async () => {
    activeMap.entities[1] = { ...activeMap.entities[1], x: 4, y: 1 };

    const result = await approachForAttack(SESSION_ID, 'shadow-roach-1', 'the-seeker', 5);

    expect(result).toMatchObject({ kind: 'approached', distanceFeet: 5, movedFeet: 10 });
    expect(entityOf('shadow-roach-1').movementRemaining).toBe(20);
    expect(getDistance(entityOf('shadow-roach-1'), entityOf('the-seeker'))).toBe(5);
  });

  test('a 40ft approach becomes movement-only when 30ft cannot reach', async () => {
    activeMap.entities[1] = { ...activeMap.entities[1], x: 9, y: 1 };

    const decision = await decideAttackApproach({
      sessionId: SESSION_ID,
      actorId: 'shadow-roach-1',
      actorLabel: 'Shadow Roach',
      targetId: 'the-seeker',
      targetLabel: 'The Seeker',
      weapon: { name: 'Bite', ranged: false, normalRange: 5 },
    });

    expect(decision).toMatchObject({
      movementOnly: true,
      result: {
        movedFeet: 30,
        distanceFeet: 10,
        reason: 'out_of_reach_after_full_movement',
        refusalReason: 'movement_exhausted',
      },
    });
    expect(approachWarnings).toContainEqual(
      expect.objectContaining({ event: 'APPROACH_PLAN', reason: 'movement_exhausted' }),
    );
  });

  test('a reachable target is closed on, and the move lands on the stored board', async () => {
    const result = await approachForAttack(SESSION_ID, 'shadow-roach-1', 'the-seeker', 5);

    expect(result).toMatchObject({ kind: 'approached', distanceFeet: 5, movedFeet: 20 });
    // The point of the whole exercise: the coordinates actually changed, and they changed on
    // the map that was saved. Which of the cells adjacent to the Seeker it picked is the
    // engine's business; that it now stands beside them is not.
    const roach = entityOf('shadow-roach-1');
    expect(roach.movementRemaining).toBe(10);
    expect(Math.max(Math.abs(roach.x - 1), Math.abs(roach.y - 1))).toBe(1);
    expect({ x: roach.x, y: roach.y }).not.toEqual({ x: 6, y: 1 });
  });

  test('the approach is published so the board on screen matches the fiction', async () => {
    await approachForAttack(SESSION_ID, 'shadow-roach-1', 'the-seeker', 5);

    const moved = broadcasts.find((payload) => payload.type === 'entity_moved');
    expect(moved).toMatchObject({ entityId: 'shadow-roach-1', movementRemaining: 10 });
    expect((moved!.path as Array<unknown>).length).toBeGreaterThan(1);
  });

  test('a target already in reach spends nothing and moves nobody', async () => {
    activeMap.entities[1] = { ...activeMap.entities[1], x: 2, y: 1 };

    const result = await approachForAttack(SESSION_ID, 'shadow-roach-1', 'the-seeker', 5);

    expect(result).toEqual({ kind: 'in_reach', distanceFeet: 5 });
    expect(entityOf('shadow-roach-1')).toMatchObject({ x: 2, y: 1, movementRemaining: 30 });
    expect(broadcasts).toHaveLength(0);
  });

  test('an unreachable target still costs the mover its full movement', async () => {
    const result = await approachForAttack(SESSION_ID, 'shadow-roach-2', 'the-seeker', 5);

    expect(result).toMatchObject({
      kind: 'unreachable',
      startingDistanceFeet: 60,
      movedFeet: 30,
      distanceFeet: 30,
      movementRemainingFeet: 0,
      pathCostFeet: 55,
      reachFeet: 5,
    });
    expect(entityOf('shadow-roach-2').movementRemaining).toBe(0);
    // It moved: an attacker that cannot reach still advances rather than standing still.
    expect(entityOf('shadow-roach-2').x).toBeLessThan(13);
    expect(broadcasts.some((payload) => payload.type === 'entity_moved')).toBe(true);
    expect(approachWarnings).toContainEqual(
      expect.objectContaining({
        event: 'APPROACH_PLAN',
        reason: 'movement_exhausted',
        from: { x: 13, y: 1 },
        to: expect.any(Object),
        distance: 30,
        path: expect.any(Array),
      }),
    );
  });

  test('blocked adjacent cells produce a reasoned refusal instead of a silent no-op', async () => {
    activeMap.entities[1] = { ...activeMap.entities[1], x: 3, y: 1 };
    for (const [x, y] of [
      [2, 0],
      [2, 1],
      [2, 2],
      [3, 0],
      [3, 2],
      [4, 0],
      [4, 1],
      [4, 2],
    ] as Array<[number, number]>) {
      activeMap.cells[y][x].blocksMovement = true;
    }

    const result = await approachForAttack(SESSION_ID, 'shadow-roach-1', 'the-seeker', 5);

    expect(result).toMatchObject({
      kind: 'unreachable',
      movedFeet: 0,
      reason: 'no_reachable_adjacent_cell',
    });
    const narrative = describeUnreachableApproach(
      'Shadow Roach',
      'The Seeker',
      result as Extract<typeof result, { kind: 'unreachable' }>,
      'an attack with its Bite',
    );
    expect(narrative).toContain('no attack was rolled');
    expect(narrative).toMatch(/obstacle at \d+,\d+/);
    expect(approachWarnings).toContainEqual(
      expect.objectContaining({
        event: 'APPROACH_PLAN',
        reason: 'no_reachable_adjacent_cell',
        path: expect.any(Array),
      }),
    );
  });

  test('a board with no such entity reports no geometry rather than guessing', async () => {
    expect(await approachForAttack(SESSION_ID, 'shadow-roach-1', 'a-ghost', 5)).toEqual({
      kind: 'no_geometry',
    });
  });

  test('reach beyond five feet stops the approach earlier', async () => {
    const result = await approachForAttack(SESSION_ID, 'shadow-roach-1', 'the-seeker', 10);

    expect(result).toMatchObject({ kind: 'approached', distanceFeet: 10, movedFeet: 15 });
    expect(entityOf('shadow-roach-1').movementRemaining).toBe(15);
  });
});

describe('the attack that follows the approach', () => {
  const bite = {
    id: 'bite',
    name: 'Bite',
    damageDice: '1d6',
    damageType: 'piercing',
    normalRange: 5,
    magicBonus: 0,
    finesse: false,
    ranged: false,
    proficient: true,
  };
  const rulesAt = (distanceFeet: number, baseTargetAc: number) =>
    resolveAttackRules({
      strength: 14,
      dexterity: 10,
      level: 1,
      baseTargetAc,
      weapon: bite,
      geometry: { distanceFeet, hasLineOfSight: true, cover: 0 },
    });

  test('an attack refused for range before the approach is legal after it', async () => {
    const seeker = () => activeMap.entities.find((entity) => entity.id === 'the-seeker')!;
    const roach = () => activeMap.entities.find((entity) => entity.id === 'shadow-roach-1')!;

    // Exactly the run 7 situation: melee declared from five cells away.
    const before = rulesAt(getDistance(roach(), seeker()), 15);
    expect(before).toMatchObject({ legal: false, refusal: 'out_of_range' });

    await approachForAttack(SESSION_ID, 'shadow-roach-1', 'the-seeker', 5);

    const after = rulesAt(getDistance(roach(), seeker()), 15);
    expect(after.legal).toBe(true);
    // The roll is resolved against the target's real armour class, not a number the DM chose.
    expect(after.targetAc).toBe(15);
  });

  test('cover the board reports is added to the armour class the roll is checked against', () => {
    expect(
      resolveAttackRules({
        strength: 14,
        dexterity: 10,
        level: 1,
        baseTargetAc: 15,
        weapon: bite,
        geometry: { distanceFeet: 5, hasLineOfSight: true, cover: 1 },
      }).targetAc,
    ).toBe(17);
  });
});
