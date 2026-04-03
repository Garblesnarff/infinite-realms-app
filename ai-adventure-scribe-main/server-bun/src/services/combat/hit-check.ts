/**
 * Hit Check Module
 *
 * Pure functions for D&D 5E attack hit/miss determination.
 * No database access - all logic is deterministic based on inputs.
 *
 * @module server/services/combat/hit-check
 */

import type { HitCheckInput, HitCheckResult } from '../../types/combat.js';

/**
 * Check if an attack hits the target
 *
 * Rules:
 * - Natural 1 always misses (even if total would hit)
 * - Natural 20 always hits and is a critical
 * - Advantage = roll 2d20, take higher
 * - Disadvantage = roll 2d20, take lower
 * - Advantage + Disadvantage = cancel out (straight roll)
 */
export function checkHit(input: HitCheckInput): HitCheckResult {
  const {
    attackRoll,
    attackBonus,
    targetAC,
    advantage: _advantage,
    disadvantage: _disadvantage,
  } = input;

  // Determine if this is a natural 1 or natural 20
  const isNaturalOne = attackRoll === 1;
  const isNaturalTwenty = attackRoll === 20;

  // Calculate total attack roll
  const totalAttackRoll = attackRoll + attackBonus;

  // Natural 1 always misses
  if (isNaturalOne) {
    return {
      hit: false,
      totalAttackRoll,
      targetAC,
      isNaturalOne: true,
      isNaturalTwenty: false,
      isCritical: false,
    };
  }

  // Natural 20 always hits and is a critical
  if (isNaturalTwenty) {
    return {
      hit: true,
      totalAttackRoll,
      targetAC,
      isNaturalOne: false,
      isNaturalTwenty: true,
      isCritical: true,
    };
  }

  // Normal hit check
  const hit = totalAttackRoll >= targetAC;

  return {
    hit,
    totalAttackRoll,
    targetAC,
    isNaturalOne: false,
    isNaturalTwenty: false,
    isCritical: false,
  };
}

/**
 * D&D 5E Auto-Crit Detection
 *
 * Per PHB: Attacks against paralyzed or unconscious creatures
 * are automatic critical hits if the attacker is within 5 feet.
 *
 * @param targetConditions - Array of condition names on the target
 * @param distanceInFeet - Distance to target (undefined = assume melee/within 5ft)
 * @returns true if the attack should be an automatic critical hit
 */
export function checkAutoCrit(targetConditions?: string[], distanceInFeet?: number): boolean {
  if (!targetConditions || targetConditions.length === 0) {
    return false;
  }

  // D&D 5E conditions that grant auto-crit within 5ft
  const autoCritConditions = ['paralyzed', 'unconscious'];

  // Check if target has any auto-crit conditions
  const hasAutoCritCondition = targetConditions.some((condition) =>
    autoCritConditions.includes(condition.toLowerCase()),
  );

  if (!hasAutoCritCondition) {
    return false;
  }

  // Auto-crit only applies within 5ft
  // If distance not specified, assume melee range (within 5ft)
  const isWithin5Feet = distanceInFeet === undefined || distanceInFeet <= 5;

  return isWithin5Feet;
}
