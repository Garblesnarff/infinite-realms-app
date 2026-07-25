import { describe, expect, test } from 'bun:test';

import { planApproach } from '../approach.js';
import { getDistance, getReachableMoves } from '../engine.js';

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

const board = (entities: MapEntity[], walls: Array<[number, number]> = []): TacticalMap => {
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
  for (const [x, y] of walls)
    cells[y][x] = { ...cells[y][x], terrain: 'wall', blocksMovement: true, blocksSight: true };
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

describe('planApproach', () => {
  test('a target already in reach costs no movement and moves nobody', () => {
    const map = board([entity('roach', 5, 5, 'monster'), entity('seeker', 6, 5, 'pc')]);
    expect(planApproach(map, 'roach', 'seeker', 5)).toMatchObject({
      destination: { x: 5, y: 5 },
      costFeet: 0,
      inReach: true,
    });
  });

  test('a target 25ft away is reached, and the plan spends only what reaching costs', () => {
    // 5 cells of Chebyshev separation is 25ft; closing to adjacency costs 20ft, not 30ft.
    const map = board([entity('roach', 5, 5, 'monster'), entity('seeker', 10, 5, 'pc')]);
    const plan = planApproach(map, 'roach', 'seeker', 5)!;
    expect(plan.inReach).toBe(true);
    expect(plan.resultingDistanceFeet).toBeLessThanOrEqual(5);
    expect(plan.costFeet).toBe(20);
  });

  test('an unreachable target still produces the closest cell the actor can afford', () => {
    // 60ft apart with 30ft of speed: the roach cannot arrive, but it must not stand still.
    const map = board([entity('roach', 2, 2, 'monster'), entity('seeker', 14, 2, 'pc')]);
    const plan = planApproach(map, 'roach', 'seeker', 5)!;
    expect(plan.inReach).toBe(false);
    // It spends everything it has and halves the gap; which of the equally-close cells it
    // picks is the engine's business, but it must not be the cell it started in.
    expect(plan.costFeet).toBe(30);
    expect(plan.resultingDistanceFeet).toBe(30);
    expect(plan.destination).not.toEqual({ x: 2, y: 2 });
  });

  test('the plan paths around a wall rather than through it', () => {
    const walls: Array<[number, number]> = [
      [7, 3],
      [7, 4],
      [7, 5],
      [7, 6],
      [7, 7],
    ];
    const map = board([entity('roach', 5, 5, 'monster'), entity('seeker', 9, 5, 'pc')], walls);
    const plan = planApproach(map, 'roach', 'seeker', 5)!;
    // Every cell the plan may choose has to be one the engine agreed was reachable.
    const reachable = getReachableMoves(map, 'roach');
    expect(reachable.some((c) => c.x === plan.destination.x && c.y === plan.destination.y)).toBe(
      true,
    );
    expect(map.cells[plan.destination.y][plan.destination.x].blocksMovement).toBe(false);
  });

  test('reach beyond 5ft is honoured, so a polearm stops further out', () => {
    const map = board([entity('guard', 5, 5, 'monster'), entity('seeker', 12, 5, 'pc')]);
    const plan = planApproach(map, 'guard', 'seeker', 10)!;
    expect(plan.inReach).toBe(true);
    expect(plan.resultingDistanceFeet).toBeLessThanOrEqual(10);
    // Stopping at 10ft costs 5ft less than closing all the way to 5ft.
    expect(plan.costFeet).toBe(25);
  });

  test('a target that is not on the board yields no plan', () => {
    const map = board([entity('roach', 5, 5, 'monster')]);
    expect(planApproach(map, 'roach', 'ghost', 5)).toBeNull();
  });

  test('difficult terrain is paid for out of the same movement budget', () => {
    const placements: MapEntity[] = [
      entity('roach', 5, 5, 'monster'),
      entity('seeker', 12, 5, 'pc'),
    ];
    const open = board(placements.map((e) => ({ ...e })));
    const mired = board(placements.map((e) => ({ ...e })));
    // A band wide enough that going around it is not cheaper than going through.
    for (let y = 3; y <= 7; y += 1)
      for (let x = 6; x <= 11; x += 1)
        mired.cells[y][x] = { ...mired.cells[y][x], terrain: 'difficult' };

    const overOpenGround = planApproach(open, 'roach', 'seeker', 5)!;
    const throughTheMire = planApproach(mired, 'roach', 'seeker', 5)!;

    // The same 30ft of movement reaches over open ground and falls short through the mire,
    // because each difficult cell costs ten feet rather than five.
    expect(overOpenGround.inReach).toBe(true);
    expect(throughTheMire.inReach).toBe(false);
    expect(throughTheMire.costFeet).toBeLessThanOrEqual(30);
    expect(throughTheMire.resultingDistanceFeet).toBeGreaterThan(5);
    expect(
      getDistance({ ...mired.entities[0], ...throughTheMire.destination }, mired.entities[1]),
    ).toBe(throughTheMire.resultingDistanceFeet);
  });
});
