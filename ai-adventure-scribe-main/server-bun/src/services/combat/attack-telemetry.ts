/**
 * One structured log line per attack resolution.
 *
 * Six consecutive playtest runs could not answer "did the monster miss, or was its damage
 * silently dropped?" — because nothing recorded what the engine rolled. Run 16 accepted four
 * attacks in its one sustained fight and produced exactly one `damage_applied` event; with
 * the player at full HP afterwards, two monster attacks were either honest misses against
 * AC 13 or damage swallowed the way the Drizzle insert-select bug used to swallow it. Both
 * hypotheses fit the evidence equally well, and no amount of re-running the playtest could
 * separate them, because the discriminating fact — the d20 and the AC it was compared
 * against — was never written down.
 *
 * So it is written down here, once per resolution, hit and miss alike. **Misses matter
 * more than hits**: a hit at least leaves a damage row behind, while a miss currently leaves
 * nothing at all, which is precisely how "monster missed" and "monster's damage vanished"
 * became indistinguishable.
 *
 * The line also carries `baseAc` beside `effectiveAc`. Cover-adjusted AC has been an open
 * question since cover was implemented and has never been checkable in production: the
 * engine applies a +2/+5 bonus internally and reports only the final number, so a cover
 * bonus that failed to apply looked exactly like a target with lower AC. Logging both ends
 * of the adjustment makes the bonus an observable quantity rather than an assumption.
 *
 * This module observes. It computes nothing that feeds back into resolution, and every
 * value it prints is read from the resolution that already happened.
 *
 * @module server/services/combat/attack-telemetry
 */

import { logger } from '../../lib/logger.js';
import { entitySlug, slugify } from '../../tactical/identity.js';

import type { TacticalMap } from '../../tactical/types.js';

/** Everything one attack resolution knows about itself, in the order a reader wants it. */
export type AttackTelemetry = {
  encounterId: string;
  attackerId: string;
  attackerSlug: string;
  targetId: string;
  targetSlug: string;
  weapon: string;
  /**
   * Which rung of the attack ladder the attacker's weapon came from:
   * `authored` | `catalog` | `derived` | `generic` for a monster, `character-sheet` for a PC.
   *
   * `derived` is the one a reader must be able to pick out: those numbers were inferred from
   * the creature's hit points because no attack was written down anywhere, and `generic` means
   * even that failed and the creature is swinging the 1d1 default this wave exists to retire.
   */
  profileSource: string;
  /** The raw d20 face, after advantage/disadvantage selection. */
  d20: number;
  attackBonus: number;
  /** `d20 + attackBonus` — the number actually compared against AC. */
  totalAttack: number;
  /** The target's AC before any cover adjustment. */
  baseAc: number;
  /** The AC the roll was compared against: `baseAc + coverBonus`. */
  effectiveAc: number;
  /** Cover grade 0–3 as the tactical engine reported it; null when off-map. */
  cover: 0 | 1 | 2 | 3 | null;
  /** `effectiveAc - baseAc`. Zero is a real answer, not a missing one. */
  coverBonus: number;
  advantage: boolean;
  disadvantage: boolean;
  outcome: 'hit' | 'miss';
  naturalOne: boolean;
  naturalTwenty: boolean;
  critical: boolean;
  /** Damage rolled before resistances. Null on a miss — nothing was rolled. */
  damageRolled: number | null;
  /** Damage written to the target's HP after resistances. Null on a miss. */
  damageApplied: number | null;
  /** Target HP after the write, so a swallowed application is visible as an unchanged HP. */
  targetHpAfter: number | null;
};

/**
 * The token the DM sees for a participant.
 *
 * Prefers the tactical map's slug, because that is the name the DM was actually shown and
 * therefore the only form a log line can be matched against a transcript by. Off-map
 * participants fall back to a slug of their display name, and a participant with neither
 * falls back to its id — never to an empty string, which would read as a missing field.
 */
export function participantSlug(
  map: TacticalMap | null | undefined,
  participantId: string,
  name?: string | null,
): string {
  const entity = map?.entities.find((candidate) => candidate.id === participantId);
  if (entity) return entitySlug(entity);
  return (name && slugify(name)) || participantId;
}

/**
 * Emit the line. Info level: this is the record of a normal gameplay event, not a fault.
 *
 * `COMBAT_ATTACK_RESOLVED` is the grep handle — one token that finds every attack in a run's
 * logs, misses included.
 */
export function logAttackResolution(telemetry: AttackTelemetry): void {
  logger.info({ msg: 'COMBAT_ATTACK_RESOLVED', ...telemetry });
}
