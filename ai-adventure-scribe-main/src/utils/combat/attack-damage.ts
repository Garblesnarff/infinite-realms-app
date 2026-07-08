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
import { getWeaponDamageDice } from '@/data/equipment/weapons';

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
    wieldedTwoHanded?: boolean;
  } = {},
): DamageCalculation {
  let damageRolls: DiceRoll[] = [];
  let baseDamage = 0;
  let damageType: DamageType = 'piercing';

  const strMod = getAbilityModifier(attacker, 'strength');
  const dexMod = getAbilityModifier(attacker, 'dexterity');

  // Barbarian Rage damage bonus calculation
  let rageBonus = 0;
  const isBarbarian = attacker.characterClass?.toLowerCase() === 'barbarian';
  if (attacker.isRaging && isBarbarian) {
    const level = attacker.level || 1;
    if (level >= 16) rageBonus = 4;
    else if (level >= 9) rageBonus = 3;
    else rageBonus = 2;
  }

  if (!weapon) {
    // Unarmed strike
    damageRolls = rollDamage('1d4', criticalHit, {});
    baseDamage = damageRolls.reduce((sum, roll) => sum + roll.total, 0);
    // Unarmed strikes use STR modifier
    baseDamage += strMod;
    damageType = 'bludgeoning';
  } else if (weapon.damage) {
    // Weapon damage
    damageRolls = rollDamage(getWeaponDamageDice(weapon, options.wieldedTwoHanded) ?? weapon.damage.dice, criticalHit, {});
    baseDamage = damageRolls.reduce((sum, roll) => sum + roll.total, 0);
    damageType = weapon.damage.type;

    if (weapon.weaponProperties?.finesse) {
      // For finesse, use STR if it's better (including rage bonus)
      const useStr = !weapon.range && strMod + rageBonus > dexMod;
      baseDamage += useStr ? strMod : dexMod;
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

  // Apply Barbarian Rage damage bonus if applicable
  // Rules: Melee weapon attacks using Strength
  const isMelee = !weapon || !weapon.range;
  const usedStr =
    !weapon || (weapon.weaponProperties?.finesse ? strMod + rageBonus > dexMod : !weapon.range);

  if (rageBonus > 0 && isMelee && usedStr) {
    baseDamage += rageBonus;
  }

  baseDamage += attacker.magicDamageBonus ?? 0;

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
  const abilityName = ability.toLowerCase();

  // 1. Check abilityScores object (Standard Character structure)
  const abilityScores = participant.abilityScores as
    Record<string, Record<string, unknown>> | undefined;
  const scoreFromObject = abilityScores?.[abilityName]?.score;
  if (typeof scoreFromObject === 'number') {
    return Math.floor((scoreFromObject - 10) / 2);
  }

  // 2. Check for direct property (Legacy/Simple structure)
  const directValue = (participant as Record<string, unknown>)[abilityName];
  if (typeof directValue === 'number') {
    return Math.floor((directValue - 10) / 2);
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
