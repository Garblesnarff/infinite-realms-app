import { beforeEach, describe, expect, mock, test } from 'bun:test';

import type { TacticalMap } from '../../../tactical/types.js';

/**
 * The run 7 acceptance test, in miniature: a headless encounter driven turn by turn, asserting
 * the property that failed for thirty consecutive turns — that the board changes.
 *
 * Run 7's monsters narrated melee from 20-30ft away and never moved once, because moving was
 * something the DM had to volunteer. Here nothing volunteers anything: each turn declares an
 * attack, and the geometry is whatever the engine makes of it.
 */
const SESSION_ID = '11111111-2222-4333-8444-555555555555';

const cells = () =>
  Array.from({ length: 24 }, () =>
    Array.from({ length: 24 }, () => ({
      terrain: 'floor' as const,
      blocksMovement: false,
      blocksSight: false,
      cover: 0 as const,
      elevation: 0,
    })),
  );

/** One PC and three roaches strung out at 25ft, 45ft, and 70ft. */
const buildMap = (): TacticalMap => ({
  id: 'map-1',
  sessionId: SESSION_ID,
  width: 24,
  height: 24,
  round: 1,
  sceneDescription: 'cave',
  cells: cells(),
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
      id: 'shadow-roach-2',
      name: 'Shadow Roach',
      x: 10,
      y: 1,
      size: 'medium',
      type: 'monster',
      speedFeet: 30,
      movementRemaining: 30,
    },
    {
      id: 'shadow-roach-3',
      name: 'Shadow Roach',
      x: 15,
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

mock.module('../tactical-map-store.js', () => ({
  loadActiveTacticalMap: async () => activeMap,
  // See combat-approach-service.test.ts: facts are recorded against the latest row, not the
  // active one, so that a fight's final blow outlives the board it happened on.
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
  broadcastToRoom: (_s: string, _sender: unknown, payload: Record<string, unknown>) => {
    broadcasts.push(payload);
  },
}));
mock.module('../../../lib/logger.js', () => ({
  logger: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
  },
  combatLogger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));

const { approachForAttack } = await import('../combat-approach-service.js');
const { resetMovement } = await import('../../../tactical/engine.js');

const positionOf = (id: string) => {
  const entity = activeMap.entities.find((candidate) => candidate.id === id)!;
  return { x: entity.x, y: entity.y };
};
const ROACHES = ['shadow-roach-1', 'shadow-roach-2', 'shadow-roach-3'];

beforeEach(() => {
  activeMap = buildMap();
  broadcasts.length = 0;
});

describe('a combat where every monster turn declares an attack', () => {
  test('coordinates change on every turn until the roaches are in reach', async () => {
    const positionsByRound: Array<Record<string, { x: number; y: number }>> = [];
    const outcomes: string[] = [];

    for (let round = 0; round < 3; round += 1) {
      for (const roach of ROACHES) {
        resetMovement(activeMap, roach);
        const result = await approachForAttack(SESSION_ID, roach, 'the-seeker', 5);
        outcomes.push(`${round}:${roach}:${result.kind}`);
      }
      positionsByRound.push(Object.fromEntries(ROACHES.map((id) => [id, positionOf(id)])));
    }

    // Round 1: the near roach arrives, the two behind it spend everything and fall short.
    expect(outcomes.slice(0, 3)).toEqual([
      '0:shadow-roach-1:approached',
      '0:shadow-roach-2:unreachable',
      '0:shadow-roach-3:unreachable',
    ]);
    // By round 2 the middle roach has closed the remaining gap.
    expect(outcomes[4]).toBe('1:shadow-roach-2:approached');
    // Every roach that was not yet in reach moved every single round: the exact failure of
    // run 7 was that this set was empty thirty times running.
    for (let round = 1; round < positionsByRound.length; round += 1)
      for (const roach of ROACHES) {
        const before = positionsByRound[round - 1][roach];
        const after = positionsByRound[round][roach];
        const distanceToSeeker = Math.max(Math.abs(after.x - 1), Math.abs(after.y - 1)) * 5;
        if (distanceToSeeker > 5) expect(after).not.toEqual(before);
      }
    // And all three finish the encounter adjacent to their target.
    for (const roach of ROACHES) {
      const { x, y } = positionOf(roach);
      expect(Math.max(Math.abs(x - 1), Math.abs(y - 1)) * 5).toBeLessThanOrEqual(5);
    }
  });

  test('every applied approach is broadcast, so the client board never drifts', async () => {
    for (const roach of ROACHES) {
      resetMovement(activeMap, roach);
      await approachForAttack(SESSION_ID, roach, 'the-seeker', 5);
    }
    const moves = broadcasts.filter((payload) => payload.type === 'entity_moved');
    expect(moves.map((move) => move.entityId)).toEqual(ROACHES);
    for (const move of moves) expect((move.path as unknown[]).length).toBeGreaterThan(1);
  });

  test('a roach that arrives stops spending movement on later turns', async () => {
    resetMovement(activeMap, 'shadow-roach-1');
    await approachForAttack(SESSION_ID, 'shadow-roach-1', 'the-seeker', 5);
    const arrived = positionOf('shadow-roach-1');

    resetMovement(activeMap, 'shadow-roach-1');
    const second = await approachForAttack(SESSION_ID, 'shadow-roach-1', 'the-seeker', 5);

    expect(second.kind).toBe('in_reach');
    expect(positionOf('shadow-roach-1')).toEqual(arrived);
  });
});
