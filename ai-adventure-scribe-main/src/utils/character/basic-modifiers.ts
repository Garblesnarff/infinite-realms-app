/**
 * Character Basic Modifiers
 *
 * Provides basic D&D 5e modifier calculation primitives, ability mappings,
 * and proficiency checking helpers.
 * Extracted from characterModifiers.ts
 *
 * @author AI Dungeon Master Team
 */

import type { Character } from '@/types/character';

import { calculateProficiencyBonus as calculateBasicProficiencyBonus } from '@/utils/character/basic-math';

// D&D 5e ability names
export type AbilityName =
  'strength' | 'dexterity' | 'constitution' | 'intelligence' | 'wisdom' | 'charisma';

// D&D 5e skills and their associated abilities
export const SKILL_ABILITIES: Record<string, AbilityName> = {
  // Strength
  athletics: 'strength',

  // Dexterity
  acrobatics: 'dexterity',
  'sleight of hand': 'dexterity',
  stealth: 'dexterity',

  // Intelligence
  arcana: 'intelligence',
  history: 'intelligence',
  investigation: 'intelligence',
  nature: 'intelligence',
  religion: 'intelligence',

  // Wisdom
  'animal handling': 'wisdom',
  insight: 'wisdom',
  medicine: 'wisdom',
  perception: 'wisdom',
  survival: 'wisdom',

  // Charisma
  deception: 'charisma',
  intimidation: 'charisma',
  performance: 'charisma',
  persuasion: 'charisma',
};

// Common alternate skill names
export const SKILL_ALIASES: Record<string, string> = {
  sleight: 'sleight of hand',
  animal: 'animal handling',
  handle: 'animal handling',
};

/**
 * Calculate ability modifier from ability score
 * Formula: floor((score - 10) / 2)
 */
export function calculateAbilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/**
 * Calculate proficiency bonus based on character level
 * D&D 5e proficiency bonus progression
 */
export function calculateProficiencyBonus(level: number): number {
  return calculateBasicProficiencyBonus(level);
}

/**
 * Get ability modifier from character
 */
export function getAbilityModifier(character: Character, ability: AbilityName): number {
  const abilityScore = character.abilityScores?.[ability];
  if (!abilityScore) {
    return 0;
  }

  // Use pre-calculated modifier if available, otherwise calculate
  return abilityScore.modifier ?? calculateAbilityModifier(abilityScore.score);
}

/**
 * Get proficiency bonus from character
 */
export function getProficiencyBonus(character: Character): number {
  return calculateProficiencyBonus(character.level || 1);
}

/**
 * Check if character is proficient in a skill
 */
export function isSkillProficient(character: Character, skillName: string): boolean {
  const normalizedSkill = skillName.toLowerCase();
  const actualSkill = SKILL_ALIASES[normalizedSkill] || normalizedSkill;

  // Check if skill is in character's skill proficiencies
  if (character.skillProficiencies) {
    return character.skillProficiencies.some((skill) => skill.toLowerCase() === actualSkill);
  }

  return false;
}

/**
 * Check if character is proficient in a saving throw
 */
export function isSaveProficient(character: Character, ability: AbilityName): boolean {
  if (character.savingThrowProficiencies) {
    return character.savingThrowProficiencies.includes(ability);
  }

  // Fallback: check abilityScores savingThrow flag
  return character.abilityScores?.[ability]?.savingThrow || false;
}
