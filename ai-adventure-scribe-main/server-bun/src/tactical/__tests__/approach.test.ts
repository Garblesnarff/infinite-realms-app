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

  test('a target 10ft away is reached by the one-step adjacent cell', () => {
    const map = board([entity('roach', 5, 5, 'monster'), entity('seeker', 7, 5, 'pc')]);
    const plan = planApproach(map, 'roach', 'seeker', 5)!;

    expect(plan).toMatchObject({
      costFeet: 5,
      resultingDistanceFeet: 5,
      inReach: true,
    });
    expect(plan.destination).not.toEqual({ x: 5, y: 5 });
    expect(plan.path).toHaveLength(2);
    expect(getDistance({ ...map.entities[0], ...plan.destination }, map.entities[1])).toBe(5);
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
    expect(plan.pathCostFeet).toBe(55);
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

  test('reports the full route cost and direct wall that blocks the cheapest approach', () => {
    const map = board([entity('roach', 1, 1, 'monster'), entity('seeker', 8, 8, 'pc')], [[5, 5]]);

    expect(planApproach(map, 'roach', 'seeker', 5)).toMatchObject({
      costFeet: 30,
      pathCostFeet: 35,
      blockingCell: { x: 5, y: 5 },
      blockingObstacle: 'wall',
      resultingDistanceFeet: 10,
      inReach: false,
    });
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

  test('across a long table the plan walks the real path instead of standing still (#1057)', () => {
    // The Eternal Feast shape from the report: Sera at (9,2), the guest at (9,7) — 25ft in
    // a straight line — with a long table row directly in front of her. Every cell she can
    // reach is exactly as far from the guest as the one she stands on (or farther), because
    // the only way closer runs along the table to its end first, and the ends are beyond
    // this turn's movement. The straight-line-greedy plan used to keep her own cell and
    // the attack died as "could not move closer" at 25ft with 30ft of speed.
    const walls: Array<[number, number]> = Array.from({ length: 16 }, (_, i) => [2 + i, 3] as [
      number,
      number,
    ]);
    const map = board([entity('sera', 9, 2, 'pc'), entity('guest', 9, 7, 'monster')], walls);
    const plan = planApproach(map, 'sera', 'guest', 5)!;
    expect(plan.inReach).toBe(false);
    // The full route around the table costs 75ft; this turn's 30ft is committed along it.
    expect(plan.pathCostFeet).toBe(75);
    expect(plan.costFeet).toBe(30);
    expect(plan.destination).not.toEqual({ x: 9, y: 2 });
    expect(plan.path[0]).toEqual({ x: 9, y: 2 });
    expect(plan.path.at(-1)).toEqual(plan.destination);
    expect(plan.path).toHaveLength(7);
    const reachable = getReachableMoves(map, 'sera');
    expect(
      reachable.some((c) => c.x === plan.destination.x && c.y === plan.destination.y),
    ).toBe(true);
  });

  test('at 10ft across a wide table the plan still commits movement along the path (#1057)', () => {
    // Tavo's shape from the same report: 10ft from the target, but the table between them
    // is wide enough that the detour costs 45ft — no reachable cell is closer in a straight
    // line, so the greedy plan stood still here too.
    const walls: Array<[number, number]> = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(
      (x) => [x, 6] as [number, number],
    );
    const map = board([entity('tavo', 5, 5, 'pc'), entity('guest', 5, 7, 'monster')], walls);
    const plan = planApproach(map, 'tavo', 'guest', 5)!;
    expect(plan.inReach).toBe(false);
    expect(plan.pathCostFeet).toBe(45);
    expect(plan.costFeet).toBe(30);
    expect(plan.destination).not.toEqual({ x: 5, y: 5 });
  });

  test('with no path at all the plan still stands still (the rift stays an honest refusal)', () => {
    // A full-height wall: there is no route, at any budget, so walking the path cannot
    // fire — standing still with pathCostFeet null is the truthful plan.
    const walls: Array<[number, number]> = Array.from({ length: 20 }, (_, y) => [7, y] as [
      number,
      number,
    ]);
    const map = board([entity('roach', 6, 6, 'monster'), entity('seeker', 9, 6, 'pc')], walls);
    const plan = planApproach(map, 'roach', 'seeker', 5)!;
    expect(plan.inReach).toBe(false);
    expect(plan.pathCostFeet).toBeNull();
    expect(plan.costFeet).toBe(0);
    expect(plan.destination).toEqual({ x: 6, y: 6 });
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
