/**
 * Round labels and the player damage total, read from engine damage events (#974).
 *
 * A hit's round is the event's round. The headline total is damage dealt by player
 * participants. A foe's damage stays on that foe's row and on its own hit.
 */

export type CombatDamageSide = 'player' | 'npc';

export interface CombatDamageEvent {
  round: number;
  side: CombatDamageSide;
  damage: number;
}

export interface CombatDamageHit {
  round: number;
  side: CombatDamageSide;
  damage: number;
  label: string;
}

export interface CombatDamageEventSummary {
  rounds: number;
  totalDamage: number;
  hits: CombatDamageHit[];
}

export function summarizeCombatDamageEvents(
  events: readonly CombatDamageEvent[],
  fallbackRound = 1,
): CombatDamageEventSummary {
  const hits: CombatDamageHit[] = [];
  let maxRound = 0;
  let totalDamage = 0;
  for (const event of events) {
    if (!Number.isFinite(event.damage) || event.damage <= 0) continue;
    if (!Number.isFinite(event.round) || event.round < 1) continue;
    if (event.round > maxRound) maxRound = event.round;
    if (event.side === 'player') totalDamage += event.damage;
    hits.push({
      round: event.round,
      side: event.side,
      damage: event.damage,
      label: `R${event.round}`,
    });
  }
  const safeFallback = Number.isFinite(fallbackRound) && fallbackRound >= 1 ? fallbackRound : 1;
  return {
    rounds: Math.max(maxRound, safeFallback),
    totalDamage,
    hits,
  };
}
