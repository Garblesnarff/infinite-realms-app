import { describe, expect, test } from 'bun:test';

import { planApproach } from '../approach.js';
import { getDistance } from '../engine.js';

import type { Cell, MapEntity, TacticalMap } from '../types.js';

const entity = (
  id: string,
  x: number,
  y: number,
  type: 'pc' | 'monster',
  speedFeet = 30,
): MapEntity => ({
  id,
  name: id,
  x,
  y,
  size: 'medium',
  type,
  speedFeet,
  movementRemaining: speedFeet,
});

const board = (entities: MapEntity[]): TacticalMap => {
  const cells: Cell[][] = Array.from({ length: 20 }, () =>
    Array.from(
      { length: 20 },
      (): Cell => ({
        terrain: 'floor',
        blocksMovement: false,
        blocksSight: false,
        cover: 0,
        elevation: 0,
      }),
    ),
  );
  return {
    id: 'map',
    sessionId: 'session',
    width: 20,
    height: 20,
    round: 1,
    sceneDescription: 'test',
    cells,
    entities,
  };
};

describe('planApproach remaining movement (#1642)', () => {
  test('with 10 ft of movement a foe 25 ft away is not in 5 ft reach', () => {
    const hero = entity('hero', 5, 5, 'pc', 30);
    hero.movementRemaining = 10;
    const foe = entity('foe', 10, 5, 'monster');
    const map = board([hero, foe]);
    expect(getDistance(hero, foe)).toBe(25);
    // 10 + 5 < 25: the hero can walk 10 ft and still be 15 ft from the foe.
    const plan = planApproach(map, 'hero', 'foe', 5);
    expect(plan).not.toBeNull();
    expect(plan?.inReach).toBe(false);
  });
});
