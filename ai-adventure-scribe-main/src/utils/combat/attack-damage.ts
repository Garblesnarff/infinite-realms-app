/**
 * Attack Damage Calculation Utilities for D&D 5e Combat System
 *
 * Extracted from attackUtils.ts to handle damage rolls, modifiers,
 * and special class-based damage bonuses (Sneak Attack, Divine Smite, Rage).
 */

import type { Equipment } from '@/data/equipmentOptions';
import type { CombatParticipant, DamageType, DiceRoll } from '@/types/combat';
import type { DamageCalculation } from '@/utils/combat/attack-types';

import { rollDamage, calculateDamage } from '@/utils/diceUtils';

/**
 * Calculate damage for an attack
 */
export function calculateAttackDamage(
  weapon: Equipment | null,
  attacker: CombatParticipant,
  criticalHit: boolean,
  options: {
    divineSmiteLevel?: number;
    sneakAttack?: boolean;
  } = {},
): DamageCalculation {
  let damageRolls: DiceRoll[] = [];
  let baseDamage = 0;
  let damageType: DamageType = 'piercing';

  if (!weapon) {
    // Unarmed strike
    damageRolls = rollDamage('1d4', criticalHit, {});
    baseDamage = damageRolls.reduce((sum, roll) => sum + roll.total, 0);
    // Unarmed strikes use STR modifier
    baseDamage += getAbilityModifier(attacker, 'strength');
    damageType = 'bludgeoning';
  } else if (weapon.damage) {
    // Weapon damage
    damageRolls = rollDamage(weapon.damage.dice, criticalHit, {});
    baseDamage = damageRolls.reduce((sum, roll) => sum + roll.total, 0);
    damageType = weapon.damage.type;

    // Add ability modifiers
    const strMod = getAbilityModifier(attacker, 'strength');
    const dexMod = getAbilityModifier(attacker, 'dexterity');

    if (weapon.weaponProperties?.finesse) {
      baseDamage += Math.max(strMod, dexMod);
    } else if (!weapon.range) {
      // Melee weapon uses STR
      baseDamage += strMod;
    } else {
      // Ranged weapon uses DEX
      baseDamage += dexMod;
    }

    // Magic weapon bonus
    if (weapon.weaponProperties?.magical) {
      baseDamage += weapon.magicBonus || 0;
    }
  }

  // Add Divine Smite damage
  if (options.divineSmiteLevel) {
    // Divine Smite: (level + 1)d8, max 5d8 (for 4th level slot or higher)
    const smiteDiceCount = Math.min(5, options.divineSmiteLevel + 1);
    const smiteRoll = rollDamage(`${smiteDiceCount}d8`, criticalHit, {});
    damageRolls = [...damageRolls, ...smiteRoll];
    baseDamage += smiteRoll.reduce((sum, roll) => sum + roll.total, 0);
    damageType = 'radiant'; // Switch to radiant as it's often more relevant for smites
  }

  // Add Sneak Attack damage
  if (options.sneakAttack) {
    const sneakDice = getSneakAttackDice(attacker.level || 1);
    const sneakRoll = rollDamage(sneakDice, criticalHit, {});
    damageRolls = [...damageRolls, ...sneakRoll];
    baseDamage += sneakRoll.reduce((sum, roll) => sum + roll.total, 0);
  }

  // Add Barbarian Rage damage bonus
  if (
    attacker.isRaging &&
    attacker.characterClass === 'barbarian' &&
    weapon &&
    !weapon.range && // Must be melee weapon
    getAbilityModifier(attacker, 'strength') >= getAbilityModifier(attacker, 'dexterity') // Must use STR
  ) {
    // D&D 5e Rage bonus: +2 (lvl 1-8), +3 (lvl 9-15), +4 (lvl 16+)
    let rageBonus = 2;
    const level = attacker.level || 1;
    if (level >= 16) rageBonus = 4;
    else if (level >= 9) rageBonus = 3;

    baseDamage += rageBonus;
  }

  const totalBeforeResistance = baseDamage;

  // Apply resistances, immunities, vulnerabilities
  const totalAfterResistance = calculateDamage(
    totalBeforeResistance,
    damageType,
    attacker.damageResistances || [],
    attacker.damageImmunities || [],
    attacker.damageVulnerabilities || [],
  );

  return {
    rolls: damageRolls,
    totalBeforeResistance,
    totalAfterResistance,
    damageType,
    resistances: attacker.damageResistances || [],
    vulnerabilities: attacker.damageVulnerabilities || [],
    immunities: attacker.damageImmunities || [],
  };
}

/**
 * Get ability modifier from participant
 * Uses default values for common abilities if not specified
 */
export function getAbilityModifier(participant: CombatParticipant, ability: string): number {
  // Check if participant has the property directly (common for some participant objects)
  const abilityName = ability.toLowerCase();
  const participantValue = (participant as Record<string, unknown>)[abilityName];

  if (typeof participantValue === 'number') {
    return Math.floor((participantValue - 10) / 2);
  }

  // Default ability scores for basic combat
  const defaultAbilityScores: { [key: string]: number } = {
    strength: 14, // Average human
    dexterity: 14,
    constitution: 14,
    intelligence: 12,
    wisdom: 12,
    charisma: 12,
  };

  // Get modifier from default scores (floor of (score-10)/2)
  const score = defaultAbilityScores[abilityName] || 12;
  return Math.floor((score - 10) / 2);
}

/**
 * Get spellcasting ability modifier
 */
export function getSpellcastingAbility(attacker: CombatParticipant): number {
  // Determine spellcasting ability based on class
  let spellAbilityName: string;

  switch (attacker.characterClass?.toLowerCase()) {
    case 'wizard':
    case 'artificer':
    case 'cloak_of_elvenkind':
    case 'arcane_trickster':
      spellAbilityName = 'intelligence';
      break;
    case 'sorcerer':
    case 'bard':
    case 'warlock':
    case 'paladin':
      spellAbilityName = 'charisma';
      break;
    case 'cleric':
    case 'druid':
    case 'ranger':
      spellAbilityName = 'wisdom';
      break;
    default:
      return 0;
  }

  return getAbilityModifier(attacker, spellAbilityName);
}

/**
 * Get sneak attack dice for rogue level
 */
export function getSneakAttackDice(level: number): string {
  const dice = Math.ceil(level / 2); // 1d6 at lvl 1-2, 2d6 at 3-4, 5d6 at 9-10
  return `${dice}d6`;
}
