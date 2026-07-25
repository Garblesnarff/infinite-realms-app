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
import { getDistance, getReachableMoves } from './engine.js';

import type { MapEntity, Point, TacticalMap } from './types.js';

export type ApproachPlan = {
  /** Where the actor should stand; equal to its current cell when no move is needed. */
  destination: Point;
  costFeet: number;
  /** Distance to the target once standing there. */
  resultingDistanceFeet: number;
  /** Whether that distance is within the attack's reach. */
  inReach: boolean;
};

const at = (entity: MapEntity, { x, y }: Point): MapEntity => ({ ...entity, x, y });

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

  return {
    destination: { x: best.cell.x, y: best.cell.y },
    costFeet: best.cell.costFeet,
    resultingDistanceFeet: best.distance,
    inReach: best.inReach,
  };
}
