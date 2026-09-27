/**
 * HP Mechanics Logic
 *
 * Extracted from CombatHPService.
 * Handles the pure logic of D&D 5E HP mechanics including damage application,
 * healing, death saves, and stabilization.
 *
 * No database access - all logic is deterministic based on inputs.
 *
 * @module server/services/combat/hp-mechanics
 */

import type {
  DamageResult,
  HealingResult,
  DeathSaveResult,
  StabilizationResult,
  ApplyDamageOptions,
} from '../../types/combat.js';

export interface HPStatusInput {
  currentHp: number;
  maxHp: number;
  tempHp: number;
  isConscious: boolean;
  deathSavesSuccesses: number;
  deathSavesFailures: number;
}

export interface ParticipantResistances {
  damageImmunities?: string[];
  damageResistances?: string[];
  damageVulnerabilities?: string[];
}

/**
 * The most of a character's maximum hit points one non-critical hit may remove.
 *
 * A safety net, deliberately independent of the party scaler in `party-scaling.ts`. The scaler
 * is arithmetic applied to a stat block, and arithmetic can be handed a stat block nobody
 * anticipated — an authored creature with a hand-written damage line, a catalog entry whose
 * dice fall outside the CR band its hit points imply, or a factor that turns out to have been
 * misjudged. This is the floor beneath all of that.
 *
 * One half rather than some smaller share because one half is the smallest fraction that
 * carries the guarantee worth having: no single ordinary blow can take a character from full
 * health to nothing, so a fight always costs at least two landed hits, so no fight is ever
 * decided by one roll. A tighter cap would start rewriting damage that was never dangerous and
 * turn the net into a second, hidden scaler.
 *
 * Applied only when the target is a player character. The net exists because a character
 * removed by one roll is a campaign ending on a coin flip; a monster has no such stake, and
 * capping damage dealt TO monsters would lengthen every fight — the grind the party scaler
 * exists to avoid.
 */
export const MAX_SINGLE_HIT_FRACTION_OF_MAX_HP = 0.5;

/** Why a hit's damage was rewritten. Always reported; never silent. */
export type DamageCapReason = 'per_hit_fraction' | 'critical_overkill_from_full_hp';

export class HPMechanics {
  /**
   * Calculate damage results based on D&D 5E rules.
   * Maintains identicality with existing CombatHPService implementation.
   */
  static calculateDamageResult(
    participantId: string,
    status: HPStatusInput,
    resistances: ParticipantResistances,
    options: ApplyDamageOptions,
  ): DamageResult {
    const {
      damageAmount,
      damageType,
      ignoreResistances = false,
      ignoreImmunities = false,
      isCriticalHit = false,
    } = options;

    let modifiedDamage = Math.max(0, damageAmount);
    let wasResisted = false;
    let wasVulnerable = false;
    let wasImmune = false;

    // Apply resistance/vulnerability/immunity
    if (damageType && !ignoreImmunities) {
      const immunities = resistances.damageImmunities || [];
      if (immunities.includes(damageType)) {
        modifiedDamage = 0;
        wasImmune = true;
      }
    }

    if (damageType && !wasImmune && !ignoreResistances) {
      const participantResistances = resistances.damageResistances || [];
      const vulnerabilities = resistances.damageVulnerabilities || [];

      if (participantResistances.includes(damageType)) {
        modifiedDamage = Math.floor(modifiedDamage / 2);
        wasResisted = true;
      } else if (vulnerabilities.includes(damageType)) {
        modifiedDamage = modifiedDamage * 2;
        wasVulnerable = true;
      }
    }

    /**
     * The per-hit ceiling, applied after resistances and before temporary hit points.
     *
     * After resistances because the cap is about what the character actually feels, not what
     * was rolled; before temp HP because temp HP is a buffer the character earned and must not
     * be spent against damage the cap was going to remove anyway.
     *
     * A critical hit is exempt from the fractional cap — a crit that could not hurt more than
     * an ordinary hit is not a crit. What a crit cannot do is kill outright from full health:
     * against a target at full hit points its damage is clamped to exactly that target's
     * current hit points, so the worst a single blow can ever do to a healthy character is put
     * them at 0 — unconscious and rolling death saving throws, which is a state they can be
     * dragged out of. Instant death in this engine requires taking damage while ALREADY at 0
     * (`massiveDamage` below), and that clamp is what guarantees one blow can never reach it.
     */
    let damageCap: DamageResult['damageCap'];
    const capTarget = options.targetIsPlayer === true;
    if (capTarget && modifiedDamage > 0) {
      if (isCriticalHit) {
        const atFullHealth = status.currentHp >= status.maxHp && status.currentHp > 0;
        if (atFullHealth && modifiedDamage > status.currentHp) {
          damageCap = {
            reason: 'critical_overkill_from_full_hp',
            rawDamage: modifiedDamage,
            cappedTo: status.currentHp,
          };
          modifiedDamage = status.currentHp;
        }
      } else {
        const cap = Math.max(1, Math.floor(status.maxHp * MAX_SINGLE_HIT_FRACTION_OF_MAX_HP));
        if (modifiedDamage > cap) {
          damageCap = {
            reason: 'per_hit_fraction',
            rawDamage: modifiedDamage,
            cappedTo: cap,
            fraction: MAX_SINGLE_HIT_FRACTION_OF_MAX_HP,
            maxHp: status.maxHp,
          };
          modifiedDamage = cap;
        }
      }
    }
    const damageDealt = modifiedDamage;

    // Apply damage to temp HP first, then real HP
    let tempHpLost = 0;
    let hpLost = 0;
    let newTempHp = status.tempHp;
    let newCurrentHp = status.currentHp;

    if (modifiedDamage > 0) {
      if (newTempHp > 0) {
        tempHpLost = Math.min(newTempHp, modifiedDamage);
        newTempHp -= tempHpLost;
        modifiedDamage -= tempHpLost;
      }

      if (modifiedDamage > 0) {
        hpLost = modifiedDamage;
        newCurrentHp = Math.max(0, newCurrentHp - hpLost);
      }
    }

    // Check for massive damage (instant death)
    // Massive damage = taking damage >= max HP while at 0 HP
    const massiveDamage = status.currentHp === 0 && hpLost >= status.maxHp;

    // D&D 5E Rule: Damage at 0 HP causes death save failures
    let deathSaveFailuresAdded = 0;
    let newDeathSavesFailures = status.deathSavesFailures;

    const wasAlreadyUnconscious = status.currentHp === 0 && !status.isConscious;

    if (wasAlreadyUnconscious && hpLost > 0 && !massiveDamage) {
      deathSaveFailuresAdded = isCriticalHit ? 2 : 1;
      newDeathSavesFailures = Math.min(3, newDeathSavesFailures + deathSaveFailuresAdded);
    }

    if (massiveDamage) {
      newDeathSavesFailures = 3;
    }

    const isDead = newDeathSavesFailures >= 3;
    const isConscious = newCurrentHp > 0;

    /**
     * #2236: a non-player participant reduced to 0 hit points dies — MM p.6, and what
     * `vitalStateOf` in death-saves-service.ts already assumes when it ends the fight.
     * Before this, the damage result said UNCONSCIOUS while the encounter logic treated
     * the same monster as dead (run 10: the engine fact said the Vitruvian Spider was
     * unconscious; the DM, reading a dead spider, narrated a carcass).
     *
     * Non-lethal knockouts are not modelled yet (#2254). Players are untouched: a player
     * at 0 HP always goes to death saves. The strict `=== false` matters —
     * `computeVitalsAfterDamage` in character-vitals-service calls this without
     * `targetIsPlayer`, and that out-of-combat path must not start killing.
     */
    const killedAtZeroHp = options.targetIsPlayer === false && newCurrentHp === 0;

    return {
      participantId,
      originalDamage: damageAmount,
      modifiedDamage,
      tempHpLost,
      hpLost,
      newCurrentHp,
      newTempHp,
      isConscious,
      isDead: isDead || killedAtZeroHp,
      wasResisted,
      wasVulnerable,
      wasImmune,
      massiveDamage,
      deathSaveFailuresAdded,
      newDeathSavesFailures,
      // What the target actually took, cap included. Callers report this rather than the
      // number they rolled: a telemetry line or a DM fact that quoted the pre-cap figure
      // would describe a blow that did not land the way it says it did.
      damageDealt,
      ...(damageCap ? { damageCap } : {}),
    };
  }

  /**
   * Calculate healing results based on D&D 5E rules.
   */
  static calculateHealingResult(
    participantId: string,
    status: HPStatusInput,
    healingAmount: number,
  ): HealingResult {
    const wasUnconscious = !status.isConscious;

    // Calculate new HP (capped at max HP)
    const newCurrentHp = Math.min(status.maxHp, status.currentHp + healingAmount);
    const healingApplied = newCurrentHp - status.currentHp;
    const overheal = healingAmount - healingApplied;

    // Revive if healing brings HP above 0
    const isConscious = newCurrentHp > 0;
    const wasRevived = wasUnconscious && isConscious;

    return {
      participantId,
      healingAmount,
      healingApplied,
      overheal,
      newCurrentHp,
      wasRevived,
      isConscious,
    };
  }

  /**
   * Resolve a death save roll.
   */
  static resolveDeathSave(
    participantId: string,
    status: HPStatusInput,
    roll: number,
  ): DeathSaveResult {
    let successes = status.deathSavesSuccesses;
    let failures = status.deathSavesFailures;
    let isStabilized = false;
    let isDead = false;
    let wasRevived = false;
    let newCurrentHp = status.currentHp;
    let isCritical = false;
    let isSuccess = false;

    // Natural 20 = revive with 1 HP
    if (roll === 20) {
      isCritical = true;
      isSuccess = true;
      wasRevived = true;
      newCurrentHp = 1;
      successes = 0;
      failures = 0;
    }
    // Natural 1 = 2 failures
    else if (roll === 1) {
      isCritical = true;
      isSuccess = false;
      failures = Math.min(3, failures + 2);
      if (failures >= 3) {
        isDead = true;
      }
    }
    // 2-9 = failure
    else if (roll < 10) {
      isSuccess = false;
      failures = Math.min(3, failures + 1);
      if (failures >= 3) {
        isDead = true;
      }
    }
    // 10-19 = success
    else {
      isSuccess = true;
      successes = Math.min(3, successes + 1);
      if (successes >= 3) {
        isStabilized = true;
      }
    }

    return {
      participantId,
      roll,
      isSuccess,
      isCritical,
      successes,
      failures,
      isStabilized,
      isDead,
      wasRevived,
      newCurrentHp,
    };
  }

  /**
   * Resolve a stabilization attempt.
   */
  static resolveStabilization(
    participantId: string,
    roll: number,
    modifier: number,
  ): StabilizationResult {
    const DC = 10;
    const total = roll + modifier;
    const success = total >= DC;

    return {
      participantId,
      success,
      dc: DC,
      roll,
      modifier,
      total,
      isStabilized: success,
      message: success
        ? 'Successfully stabilized! The creature is unconscious but no longer dying.'
        : `Stabilization failed (DC ${DC}, rolled ${total}). The creature is still dying.`,
    };
  }
}
