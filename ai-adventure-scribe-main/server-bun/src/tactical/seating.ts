import { canOccupy, getDistance } from './engine.js';

import type { MapEntity, TacticalMap } from './types.js';

export type CombatSeatingReason = 'conversation' | 'asset_tag';

export interface CombatSeatingHint {
  targetId: string;
  targetLabel: string;
  reason: CombatSeatingReason;
}

/** Place a hinted conversational/scene target in melee range without moving the player. */
export function seatEntityWithinReach(
  map: TacticalMap,
  targetId: string,
  playerId: string,
  reachFeet = 5,
): { distanceFeet: number } | null {
  const player = map.entities.find((entity) => entity.id === playerId);
  const target = map.entities.find((entity) => entity.id === targetId);
  if (!player || !target) return null;

  const candidates: Array<{ x: number; y: number; distanceFeet: number; displacement: number }> =
    [];
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const candidate = { ...target, x, y } satisfies MapEntity;
      if (!canOccupy(map, candidate, x, y, target.id)) continue;
      const distanceFeet = getDistance(player, candidate);
      if (distanceFeet > reachFeet) continue;
      candidates.push({
        x,
        y,
        distanceFeet,
        displacement: Math.max(Math.abs(x - target.x), Math.abs(y - target.y)),
      });
    }
  }

  const best = candidates.sort(
    (left, right) =>
      left.distanceFeet - right.distanceFeet || left.displacement - right.displacement,
  )[0];
  if (!best) return null;

  target.x = best.x;
  target.y = best.y;
  target.movementRemaining = target.speedFeet;
  return { distanceFeet: best.distanceFeet };
}
