/**
 * Closing the gap before an attack.
 *
 * Movement used to be something the DM had to volunteer: the prompt asked it to emit a
 * `map_actions` move whenever a melee target was beyond reach, and across a thirty-turn
 * encounter it emitted none while narrating melee at 20-30ft. Models narrate fiction, not
 * geometry, so the engine stops asking. An attack is an intent, and walking into reach is
 * part of executing it — the same way a player character does not send footstep events.
 *
 * This module is pure: it reads a map and returns where the actor should stand. Applying,
 * persisting, and broadcasting the move stays with the tactical action service.
 */
import { bresenham, canOccupy, findPath, getDistance, getReachableMoves } from './engine.js';

import type { MapEntity, Point, TacticalMap } from './types.js';

export type ApproachPlan = {
  /** Where the actor should stand; equal to its current cell when no move is needed. */
  destination: Point;
  costFeet: number;
  /** The engine path to the selected destination, including the current cell. */
  path: Point[];
  /** Distance to the target once standing there. */
  resultingDistanceFeet: number;
  /** Whether that distance is within the attack's reach. */
  inReach: boolean;
  /** The cheapest path cost to any cell from which the attack would be in reach. */
  pathCostFeet: number | null;
  /** A map cell that explains why a direct route is longer or unavailable, when present. */
  blockingCell?: Point;
  blockingObstacle?: string;
};

const at = (entity: MapEntity, { x, y }: Point): MapEntity => ({ ...entity, x, y });

const cellIsBlocking = (map: TacticalMap, point: Point): boolean =>
  Boolean(map.cells[point.y]?.[point.x]?.blocksMovement);

const blockingCellFor = (
  map: TacticalMap,
  actor: MapEntity,
  target: MapEntity,
  reachFeet: number,
): Point | null => {
  const directBlocker = bresenham({ x: actor.x, y: actor.y }, { x: target.x, y: target.y })
    .slice(1, -1)
    .find((point) => cellIsBlocking(map, point));
  if (directBlocker) return directBlocker;

  // When every useful destination is sealed, the direct segment may miss the actual wall. Pick
  // a blocked cell in the target's reach ring so the refusal still names a concrete obstacle.
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const point = { x, y };
      if (cellIsBlocking(map, point) && getDistance(at(actor, point), target) <= reachFeet)
        return point;
    }
  }
  return null;
};

const obstacleNameAt = (map: TacticalMap, point: Point | null): string | undefined => {
  if (!point) return undefined;
  const cell = map.cells[point.y]?.[point.x];
  if (!cell?.blocksMovement) return undefined;
  return cell.decoration ?? (cell.terrain === 'floor' ? 'obstacle' : cell.terrain);
};

/**
 * The cell to attack from: the cheapest one inside reach, or — when reach is unattainable
 * this turn — the reachable cell that gets closest, so a failed approach still visibly
 * commits the actor's movement instead of leaving it standing still.
 */
export function planApproach(
  map: TacticalMap,
  actorId: string,
  targetId: string,
  reachFeet: number,
): ApproachPlan | null {
  const actor = map.entities.find((entity) => entity.id === actorId);
  const target = map.entities.find((entity) => entity.id === targetId);
  if (!actor || !target) return null;

  const candidates = getReachableMoves(map, actorId);
  // The actor's own cell is always a candidate: standing still is the right plan when the
  // target is already in reach, and the fallback when nothing on the board improves matters.
  if (!candidates.some((cell) => cell.x === actor.x && cell.y === actor.y))
    candidates.push({ x: actor.x, y: actor.y, costFeet: 0 });

  const scored = candidates.map((cell) => {
    const distance = getDistance(at(actor, cell), target);
    return { cell, distance, inReach: distance <= reachFeet };
  });

  const reaching = scored.filter((option) => option.inReach);
  // Among cells that reach, the cheapest wins: movement spent here is movement the actor
  // cannot spend later, so approach never costs more than the attack requires.
  const best = (reaching.length ? reaching : scored).reduce((a, b) => {
    if (reaching.length) return b.cell.costFeet < a.cell.costFeet ? b : a;
    if (b.distance !== a.distance) return b.distance < a.distance ? b : a;
    return b.cell.costFeet < a.cell.costFeet ? b : a;
  });

  // `getReachableMoves` is intentionally budget-limited because its result drives movement.
  // For narration we also need the route that would have reached melee with unlimited movement;
  // otherwise a detour around a wall is incorrectly reported as a 30ft path when it costs 35ft.
  const fullPathCandidates: Array<{ path: Point[]; costFeet: number; distance: number }> = [];
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const destination = { x, y };
      if (!canOccupy(map, actor, x, y) || getDistance(at(actor, destination), target) > reachFeet)
        continue;
      const path = findPath(map, actorId, x, y);
      if (path)
        fullPathCandidates.push({
          path: path.path,
          costFeet: path.costFeet,
          distance: getDistance(at(actor, destination), target),
        });
    }
  }
  const fullPath = fullPathCandidates.sort(
    (left, right) => left.costFeet - right.costFeet || left.distance - right.distance,
  )[0];
  const blockingCell = blockingCellFor(map, actor, target, reachFeet);

  const path = findPath(map, actorId, best.cell.x, best.cell.y)?.path ?? [
    { x: actor.x, y: actor.y },
  ];

  return {
    destination: { x: best.cell.x, y: best.cell.y },
    costFeet: best.cell.costFeet,
    path,
    resultingDistanceFeet: best.distance,
    inReach: best.inReach,
    pathCostFeet: fullPath?.costFeet ?? null,
    ...(blockingCell
      ? {
          blockingCell,
          blockingObstacle: obstacleNameAt(map, blockingCell),
        }
      : {}),
  };
}
