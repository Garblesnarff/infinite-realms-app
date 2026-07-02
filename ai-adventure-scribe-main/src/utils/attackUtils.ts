/**
 * Attack Resolution Utilities for D&D 5e Combat System
 *
 * Handles attack rolls, damage calculation, AC checks, critical hits,
 * and multi-attack mechanics based on character equipment and stats.
 */

import type { Equipment } from '@/data/equipmentOptions';
import type { CombatParticipant } from '@/types/combat';
import type {
  AttackResolution,
  DamageCalculation,
  FullAttackResult,
} from '@/utils/combat/attack-types';

import {
  calculateAttackDamage,
  getAbilityModifier,
  getSpellcastingAbility,
  getSneakAttackDice,
} from '@/utils/combat/attack-damage';
import {
  createCombatActionFromAttack,
  generateAttackDescription,
} from '@/utils/combat/attack-narration';
import { resolveAttack } from '@/utils/combat/attack-resolution';
import { calculateDamage } from '@/utils/diceUtils';

// Re-export extracted types and functions for backward compatibility
export type { AttackResolution, DamageCalculation, FullAttackResult };
export {
  resolveAttack,
  calculateAttackDamage,
  getAbilityModifier,
  getSpellcastingAbility,
  getSneakAttackDice,
  createCombatActionFromAttack,
  generateAttackDescription,
};

/**
 * Execute complete attack resolution (attack + damage)
 */
export function performAttack(
  weapon: Equipment | null,
  attacker: CombatParticipant,
  target: CombatParticipant,
  options: {
    advantage?: boolean;
    disadvantage?: boolean;
    spellAttack?: boolean;
    divineSmiteLevel?: number;
    sneakAttack?: boolean;
  } = {},
): FullAttackResult {
  // Resolve the attack
  const resolution = resolveAttack(weapon, attacker, target, options);

  // If attack misses, return result with no damage
  if (!resolution.hit) {
    return {
      resolution,
      damage: null,
    };
  }

  // Calculate damage
  const damage = calculateAttackDamage(weapon, attacker, resolution.criticalHit, options);

  // Calculate final damage after target's resistances/vulnerabilities
  const damageToDeal = calculateDamage(
    damage.totalBeforeResistance,
    damage.damageType,
    target.damageResistances || [],
    target.damageImmunities || [],
    target.damageVulnerabilities || [],
  );

  // Apply temporary HP first
  const tempHpToReduce = Math.min(target.temporaryHitPoints, damageToDeal);
  const remainingDamage = damageToDeal - tempHpToReduce;
  const _newTempHp = target.temporaryHitPoints - tempHpToReduce;
  const newHp =
    remainingDamage > 0
      ? Math.max(0, target.currentHitPoints - remainingDamage)
      : target.currentHitPoints;

  return {
    resolution,
    damage: {
      ...damage,
      totalAfterResistance: damageToDeal,
    },
    targetReducedHp: newHp,
    totalDamageDealt: damageToDeal,
  };
}

/**
 * Get number of attacks for multi-attack feature
 */
export function getNumberOfAttacks(
  cfg: { specific?: Record<string, unknown> } | null | undefined,
  characterClass: string,
  level: number,
): number {
  // Martial classes with Extra Attack
  if (['fighter', 'paladin', 'ranger', 'barbarian'].includes(characterClass.toLowerCase())) {
    if (level >= 11) return 3; // Level 11: Three attacks
    if (level >= 5) return 2; // Level 5: Two attacks
  }

  // Other classes with Extra Attack
  if (['rogue', 'monk'].includes(characterClass.toLowerCase())) {
    if (level >= 5) return 2; // Level 5: Two attacks
  }

  // Eldritch Knight and Arcane Trickster
  if (characterClass.toLowerCase() === 'fighter') {
    if (cfg?.specific && typeof cfg.specific['eldritch_knight'] !== 'undefined' && level >= 5) {
      return 2;
    }
  }

  return 1; // Default: one attack
}

/**
 * Check if sneak attack can be applied.
 */
export function canUseSneakAttack(
  attacker: CombatParticipant,
  target: CombatParticipant,
  allParticipants: CombatParticipant[] = [],
): boolean {
  // Must be a rogue
  if (attacker.characterClass?.toLowerCase() !== 'rogue') return false;

  // Basic condition: advantage on the attack roll.
  const hasAdvantage =
    attacker.conditions.some((c) => c.name === 'invisible') ||
    target.conditions.some((c) =>
      ['prone', 'stunned', 'paralyzed', 'unconscious'].includes(c.name),
    );

  if (hasAdvantage) return true;

  // Sneak attack also applies if another enemy of the target is within 5 feet of it,
  // that enemy isn't incapacitated, and the attacker doesn't have disadvantage.

  // TODO: This is a placeholder for ally position tracking.
  // A full implementation requires iterating through `allParticipants` and calculating
  // the distance between each of the attacker's allies and the target.
  // For now, we'll simulate this by checking if any other non-incapacitated ally exists.
  const isAllyNearby = allParticipants.some(
    (p) =>
      p.id !== attacker.id &&
      p.participantType === attacker.participantType &&
      !p.conditions.some((c) => c.name === 'incapacitated'),
  );

  return isAllyNearby;
}
