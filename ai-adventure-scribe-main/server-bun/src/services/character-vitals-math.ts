/**
 * Pure vitals arithmetic. Kept off the database client so unit tests can call
 * `computeVitalsAfterDamage` without a DATABASE_URL.
 */
import { HPMechanics } from './combat/hp-mechanics.js';
import { DEATH_SAVE_LIMIT } from '../../../shared/death-save-limit.js';

import type { HPStatusInput } from './combat/hp-mechanics.js';
import type { VitalState } from '../../../db/schema/index';

/** A character's full vital state, as read from or written to `character_stats`. */
export interface CharacterVitals {
  characterId: string;
  currentHitPoints: number;
  maxHitPoints: number;
  temporaryHitPoints: number;
  isConscious: boolean;
  deathSavesSuccesses: number;
  deathSavesFailures: number;
  vitalState: VitalState;
  diedAt: Date | null;
}

/** The columns a vitals write is allowed to touch. */
export interface VitalsWrite {
  currentHitPoints: number;
  temporaryHitPoints: number;
  isConscious: boolean;
  vitalState: VitalState;
  deathSavesSuccesses: number;
  deathSavesFailures: number;
  /**
   * Left `undefined` by every out-of-combat path, and then not written at all. Only the
   * combat mirror below has a reason to stamp it, and only on the transition into `dead`.
   */
  diedAt?: Date | null;
}

/**
 * What combat resolved, in character-record terms.
 *
 * Deliberately not a damage or healing request: by the time combat calls the mirror it has
 * already run `HPMechanics` against the participant row — with that row's resistances, the
 * per-hit cap and the crit rules — and the character record's job is to record that outcome,
 * not to recompute it and risk landing somewhere else.
 */
export interface CombatResolvedVitals {
  currentHitPoints: number;
  /** Omitted by the paths that do not touch temporary hit points (healing, death saves). */
  temporaryHitPoints?: number;
  isConscious: boolean;
  deathSavesSuccesses: number;
  deathSavesFailures: number;
  /**
   * Set only where the counters cannot express the state combat reached. A successful Medicine
   * check clears both counters, which is indistinguishable from "dying, nothing rolled yet"
   * unless the state is named outright.
   */
  vitalState?: VitalState;
}

function toHpStatusInput(vitals: CharacterVitals): HPStatusInput {
  return {
    currentHp: vitals.currentHitPoints,
    maxHp: vitals.maxHitPoints,
    tempHp: vitals.temporaryHitPoints,
    isConscious: vitals.isConscious,
    deathSavesSuccesses: vitals.deathSavesSuccesses,
    deathSavesFailures: vitals.deathSavesFailures,
  };
}

/**
 * What a character's vitals become after taking `amount` damage.
 *
 * Exported for the regression test that pins the walking-corpse bug: 15 damage on an
 * 11 HP character must land at 0 and unconscious — never back at 11/11, never clamped
 * to 1.
 *
 * Two things `HPMechanics` offers are deliberately not used here:
 *
 * - `targetIsPlayer` (the half-max-HP per-hit cap) is NOT set. That cap is a combat
 *   safety net against a mis-scaled stat block deciding a fight on one roll. This path
 *   carries a number the DM already resolved — fall damage, a trap, a hazard — and
 *   silently halving it would re-create the defect this service exists to fix, one step
 *   further down.
 * - (Death-save failures at 0 HP ARE kept: SRD 5.1, damage at 0 HP is one failure, two for a
 *   critical hit, and massive damage is death. The same rule as an attack in combat, #2518.)
 *
 * Damage type is not applied either: the route carries a bare amount, so there is
 * nothing to match against a resistance list.
 */
export function computeVitalsAfterDamage(
  current: CharacterVitals,
  amount: number,
  options: { critical?: boolean } = {},
): VitalsWrite {
  const damageAmount = Math.max(0, Math.trunc(amount));
  const result = HPMechanics.calculateDamageResult(
    current.characterId,
    toHpStatusInput(current),
    {},
    { damageAmount, isCriticalHit: options.critical === true },
  );

  let vitalState: VitalState = current.vitalState;
  if (result.newCurrentHp === 0 && current.vitalState !== 'dead') {
    // Includes a character who was already dying: they stay at 0 and stay dying. It also
    // covers a stabilized character taking a fresh hit, who starts dying again.
    vitalState = 'dying';
  }

  // Instant death (SRD 5.1) holds for every source of damage: a hazard or a DM-authored blow
  // that drops a character to 0 with the overflow at or above their maximum kills them here
  // and now, with no dying phase.
  if (result.massiveDamage && current.vitalState !== 'dead') {
    return {
      currentHitPoints: 0,
      temporaryHitPoints: result.newTempHp,
      isConscious: false,
      vitalState: 'dead',
      deathSavesSuccesses: 0,
      deathSavesFailures: DEATH_SAVE_LIMIT,
      diedAt: new Date(),
    };
  }

  // The dead take no further failures; for anyone else the tallies are the damage rules' answer
  // (a fresh drop starts over, damage at 0 HP adds a failure, a hit on a stable character makes
  // them dying again with their successes cleared).
  const failures =
    current.vitalState === 'dead' ? current.deathSavesFailures : result.newDeathSavesFailures;
  const successes =
    current.vitalState === 'dead'
      ? current.deathSavesSuccesses
      : (result.newDeathSavesSuccesses ?? current.deathSavesSuccesses);
  const diesNow = current.vitalState !== 'dead' && failures >= DEATH_SAVE_LIMIT;
  return {
    currentHitPoints: result.newCurrentHp,
    temporaryHitPoints: result.newTempHp,
    isConscious: result.isConscious,
    vitalState: diesNow ? 'dead' : vitalState,
    deathSavesSuccesses: successes,
    deathSavesFailures: failures,
    ...(diesNow ? { diedAt: new Date() } : {}),
  };
}

/**
 * What a character's vitals become after being healed by `amount`.
 *
 * Any healing that leaves the character above 0 HP brings them back up: conscious,
 * standing, death saves cleared. A character whose `vital_state` is already `dead` is
 * left exactly as they are — raising the dead is a PR3 concern, and PR1 has no path that
 * can produce that state in the first place.
 */
export function computeVitalsAfterHeal(current: CharacterVitals, amount: number): VitalsWrite {
  const unchanged: VitalsWrite = {
    currentHitPoints: current.currentHitPoints,
    temporaryHitPoints: current.temporaryHitPoints,
    isConscious: current.isConscious,
    vitalState: current.vitalState,
    deathSavesSuccesses: current.deathSavesSuccesses,
    deathSavesFailures: current.deathSavesFailures,
  };

  if (current.vitalState === 'dead') return unchanged;

  const healingAmount = Math.max(0, Math.trunc(amount));
  const result = HPMechanics.calculateHealingResult(
    current.characterId,
    toHpStatusInput(current),
    healingAmount,
  );

  const isUpright = result.newCurrentHp > 0;

  return {
    ...unchanged,
    currentHitPoints: result.newCurrentHp,
    // 5E: healing restores hit points; temporary hit points are a separate pool and are
    // never topped up by it.
    temporaryHitPoints: current.temporaryHitPoints,
    isConscious: isUpright,
    vitalState: isUpright ? 'standing' : current.vitalState,
    deathSavesSuccesses: isUpright ? 0 : current.deathSavesSuccesses,
    deathSavesFailures: isUpright ? 0 : current.deathSavesFailures,
  };
}
