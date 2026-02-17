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

export class HPMechanics {
  /**
   * Calculate damage results based on D&D 5E rules.
   * Maintains identicality with existing CombatHPService implementation.
   */
  static calculateDamageResult(
    participantId: string,
    status: HPStatusInput,
    resistances: ParticipantResistances,
    options: ApplyDamageOptions
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

    return {
      participantId,
      originalDamage: damageAmount,
      modifiedDamage,
      tempHpLost,
      hpLost,
      newCurrentHp,
      newTempHp,
      isConscious,
      isDead,
      wasResisted,
      wasVulnerable,
      wasImmune,
      massiveDamage,
      deathSaveFailuresAdded,
      newDeathSavesFailures,
    };
  }

  /**
   * Calculate healing results based on D&D 5E rules.
   */
  static calculateHealingResult(
    participantId: string,
    status: HPStatusInput,
    healingAmount: number
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
    roll: number
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
    modifier: number
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
