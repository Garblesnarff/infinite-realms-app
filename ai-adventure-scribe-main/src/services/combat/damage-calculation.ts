/**
 * Pure damage math: resistances, immunities, and vulnerabilities.
 */

import type { DamageType } from '@/types/combat';

import logger from '@/lib/logger';

/**
 * Calculate actual damage after resistances, immunities, and vulnerabilities
 */
export function calculateModifiedDamage(
  baseDamage: number,
  damageType: DamageType,
  resistances: string[],
  immunities: string[],
  vulnerabilities: string[],
): number {
  // Immunity = 0 damage
  if (immunities.includes(damageType)) {
    logger.info(`[DamageIntegrator] Damage type ${damageType} is immune - 0 damage`);
    return 0;
  }

  let modifiedDamage = baseDamage;

  // Resistance = half damage (rounded down)
  if (resistances.includes(damageType)) {
    const reduced = Math.floor(modifiedDamage / 2);
    logger.info(
      `[DamageIntegrator] Damage type ${damageType} is resisted - ${modifiedDamage} → ${reduced}`,
    );
    modifiedDamage = reduced;
  }

  // Vulnerability = double damage
  if (vulnerabilities.includes(damageType)) {
    const doubled = modifiedDamage * 2;
    logger.info(
      `[DamageIntegrator] Damage type ${damageType} is vulnerable - ${modifiedDamage} → ${doubled}`,
    );
    modifiedDamage = doubled;
  }

  return modifiedDamage;
}
