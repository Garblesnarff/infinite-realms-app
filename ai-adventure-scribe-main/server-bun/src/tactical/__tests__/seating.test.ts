import { describe, expect, it } from 'bun:test';

import { seatEntityWithinReach } from '../seating.js';

const map = {
  id: 'map-1',
  sessionId: 'session-1',
  width: 8,
  height: 3,
  round: 1,
  sceneDescription: 'An open room.',
  cells: Array.from({ length: 3 }, () =>
    Array.from({ length: 8 }, () => ({
      terrain: 'floor' as const,
      blocksMovement: false,
      blocksSight: false,
      cover: 0 as const,
      elevation: 0,
    })),
  ),
  entities: [
    {
      id: 'player',
      name: 'Rook',
      x: 1,
      y: 1,
      size: 'medium' as const,
      type: 'pc' as const,
      speedFeet: 30,
      movementRemaining: 30,
    },
    {
      id: 'target',
      name: 'Professor',
      x: 6,
      y: 1,
      size: 'medium' as const,
      type: 'monster' as const,
      speedFeet: 30,
      movementRemaining: 0,
    },
  ],
};

describe('seatEntityWithinReach', () => {
  it('seats a conversational target at five feet or less', () => {
    const result = seatEntityWithinReach(map, 'target', 'player');
    const player = map.entities[0];
    const target = map.entities[1];

    expect(result?.distanceFeet).toBeLessThanOrEqual(5);
    expect(
      Math.max(Math.abs(player.x - target.x), Math.abs(player.y - target.y)) * 5,
    ).toBeLessThanOrEqual(5);
    expect(target.movementRemaining).toBe(30);
  });

  it('returns no placement when every candidate cell is blocked', () => {
    const blockedMap = {
      ...map,
      cells: map.cells.map((row) => row.map((cell) => ({ ...cell, blocksMovement: true }))),
    };

    expect(seatEntityWithinReach(blockedMap, 'target', 'player')).toBeNull();
  });
});
