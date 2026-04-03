/**
 * Damage Calculator Module
 *
 * Pure functions for D&D 5E damage calculation including
 * critical hits, resistance/vulnerability/immunity application,
 * and dice rolling.
 *
 * No database access - all logic is deterministic based on inputs
 * (except for random dice rolls).
 *
 * @module server/services/combat/damage-calculator
 */

import { ValidationError } from '../../lib/errors.js';

import type { DamageCalculationInput, DamageCalculationResult } from '../../types/combat.js';

/**
 * Calculate damage with resistance/vulnerability/immunity
 *
 * Rules:
 * - Critical hit = roll damage dice twice, add modifiers once
 * - Resistance = half damage (round down)
 * - Vulnerability = double damage
 * - Immunity = no damage
 * - Resistance and vulnerability cancel out
 */
export function calculateDamage(input: DamageCalculationInput): DamageCalculationResult {
  const {
    damageDice,
    damageBonus,
    damageType,
    isCritical = false,
    resistances = [],
    vulnerabilities = [],
    immunities = [],
    damageRoll,
  } = input;

  // Check for immunity first
  const effectiveImmunity = immunities.includes(damageType);
  if (effectiveImmunity) {
    return {
      baseDamage: 0,
      damageBeforeResistances: 0,
      effectiveResistance: false,
      effectiveVulnerability: false,
      effectiveImmunity: true,
      finalDamage: 0,
      damageType,
    };
  }

  // Calculate base damage from dice
  let baseDamage: number;
  if (damageRoll !== undefined) {
    // Use provided damage roll
    baseDamage = damageRoll;
    if (isCritical) {
      // Critical: double the dice damage, then add modifier once
      baseDamage = (damageRoll - damageBonus) * 2 + damageBonus;
    }
  } else {
    // Parse dice notation and roll
    baseDamage = rollDamageDice(damageDice, isCritical) + damageBonus;
  }

  const damageBeforeResistances = baseDamage;

  // Check for resistance and vulnerability
  const hasResistance = resistances.includes(damageType);
  const hasVulnerability = vulnerabilities.includes(damageType);

  // Resistance and vulnerability cancel out
  const effectiveResistance = hasResistance && !hasVulnerability;
  const effectiveVulnerability = hasVulnerability && !hasResistance;

  let finalDamage = damageBeforeResistances;

  // Apply resistance (half damage, round down)
  if (effectiveResistance) {
    finalDamage = Math.floor(finalDamage / 2);
  }

  // Apply vulnerability (double damage)
  if (effectiveVulnerability) {
    finalDamage = finalDamage * 2;
  }

  return {
    baseDamage,
    damageBeforeResistances,
    effectiveResistance,
    effectiveVulnerability,
    effectiveImmunity: false,
    finalDamage,
    damageType,
  };
}

/**
 * Resolve a critical hit
 * Critical hits double the damage dice (not the modifiers)
 */
export function resolveCriticalHit(
  damageDice: string,
  damageBonus: number,
  damageRoll?: number,
): number {
  if (damageRoll !== undefined) {
    // Double the dice portion, add modifier once
    return (damageRoll - damageBonus) * 2 + damageBonus;
  }

  // Roll damage dice twice
  const normalDamage = rollDamageDice(damageDice, false);
  const criticalDamage = normalDamage * 2 + damageBonus;
  return criticalDamage;
}

/**
 * Helper: Roll damage dice
 * Parses dice notation like "1d8", "2d6", etc.
 */
export function rollDamageDice(damageDice: string, isCritical: boolean): number {
  const match = /^(\d+)d(\d+)$/i.exec(damageDice.trim());
  if (!match || !match[1] || !match[2]) {
    throw new ValidationError(`Invalid dice notation: ${damageDice}`, { damageDice });
  }

  const count = parseInt(match[1], 10);
  const sides = parseInt(match[2], 10);

  // For critical, double the number of dice
  const diceToRoll = isCritical ? count * 2 : count;

  let total = 0;
  for (let i = 0; i < diceToRoll; i++) {
    total += Math.floor(Math.random() * sides) + 1;
  }

  return total;
}
