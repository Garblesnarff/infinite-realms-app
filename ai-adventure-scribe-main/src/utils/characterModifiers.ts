/**
 * Character Modifiers Utility
 *
 * Calculates D&D 5e modifiers for dice rolls based on character stats.
 * Handles ability modifiers, proficiency bonus, and roll calculations.
 *
 * @author AI Dungeon Master Team
 */

import type { Equipment } from '@/data/equipmentOptions';
import type { Character } from '@/types/character';

import logger from '@/lib/logger';
import {
  getAbilityModifier,
  getProficiencyBonus,
  isSaveProficient,
  isSkillProficient,
  SKILL_ABILITIES,
  SKILL_ALIASES,
  type AbilityName,
} from '@/utils/character/basic-modifiers';
import { hasProficiency } from '@/utils/character/parse-proficiency-list';

// Re-export basic modifier definitions and helpers
export {
  calculateAbilityModifier,
  calculateProficiencyBonus,
  getAbilityModifier,
  getProficiencyBonus,
  isSkillProficient,
  isSaveProficient,
  SKILL_ABILITIES,
  SKILL_ALIASES,
} from '@/utils/character/basic-modifiers';
export type { AbilityName } from '@/utils/character/basic-modifiers';

// Re-export roll breakdown functions and types
export {
  generateDiceFormula,
  calculateRollWithBreakdown,
  getCharacterStatsForAI,
} from '@/utils/character/roll-breakdown';
export type { RollCalculation } from '@/utils/character/roll-breakdown';

/**
 * Calculate skill check modifier
 */
export function calculateSkillModifier(character: Character, skillName: string): number {
  const normalizedSkill = skillName.toLowerCase();
  const actualSkill = SKILL_ALIASES[normalizedSkill] || normalizedSkill;

  // Get the ability associated with this skill
  const ability = SKILL_ABILITIES[actualSkill];
  if (!ability) {
    logger.warn(`Unknown skill: ${skillName}`);
    return 0;
  }

  const abilityMod = getAbilityModifier(character, ability);
  const proficient = isSkillProficient(character, skillName);
  const expertise = hasProficiency(character.expertiseProficiencies, actualSkill);
  const proficiencyBonus = proficient ? getProficiencyBonus(character) * (expertise ? 2 : 1) : 0;

  return abilityMod + proficiencyBonus;
}

/**
 * Calculate saving throw modifier
 */
export function calculateSaveModifier(character: Character, ability: AbilityName): number {
  const abilityMod = getAbilityModifier(character, ability);
  const proficient = isSaveProficient(character, ability);
  const proficiencyBonus = proficient ? getProficiencyBonus(character) : 0;

  return abilityMod + proficiencyBonus;
}

/**
 * Calculate attack roll modifier.
 * This function now considers weapon properties like 'finesse'.
 * @param character The character making the attack.
 * @param weapon The weapon being used (optional). If not provided, defaults to an unarmed strike (strength).
 * @returns The total attack modifier.
 */
export function calculateAttackModifier(character: Character, weapon?: Equipment | null): number {
  let abilityMod: number;
  const proficiencyBonus = getProficiencyBonus(character); // Assume proficiency with the weapon

  const strMod = getAbilityModifier(character, 'strength');
  const dexMod = getAbilityModifier(character, 'dexterity');

  if (weapon) {
    const isFinesse = weapon.weaponProperties?.finesse;
    const isRanged = !!weapon.range;

    if (isFinesse) {
      // Use the higher of DEX or STR for finesse weapons
      abilityMod = Math.max(strMod, dexMod);
    } else if (isRanged) {
      // Use DEX for ranged weapons
      abilityMod = dexMod;
    } else {
      // Use STR for non-finesse melee weapons
      abilityMod = strMod;
    }
  } else {
    // Default to STR for unarmed strikes or unspecified melee attacks
    abilityMod = strMod;
  }

  return abilityMod + proficiencyBonus;
}

/**
 * Calculate initiative modifier
 */
export function calculateInitiativeModifier(character: Character): number {
  return getAbilityModifier(character, 'dexterity');
}

/**
 * Parse ability name from various formats
 */
export function parseAbilityName(input: string): AbilityName | null {
  const normalized = input.toLowerCase().trim();

  const abilityMap: Record<string, AbilityName> = {
    str: 'strength',
    strength: 'strength',
    dex: 'dexterity',
    dexterity: 'dexterity',
    con: 'constitution',
    constitution: 'constitution',
    int: 'intelligence',
    intelligence: 'intelligence',
    wis: 'wisdom',
    wisdom: 'wisdom',
    cha: 'charisma',
    charisma: 'charisma',
  };

  return abilityMap[normalized] || null;
}
