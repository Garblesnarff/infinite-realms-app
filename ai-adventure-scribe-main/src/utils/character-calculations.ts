import { SPELLCASTING_ABILITY_MAP, FULL_CASTER_SLOTS_MAP } from './character-calculations-data';
import {
  calculateSkillModifiers,
  calculateSavingThrowModifiers,
  getClassSkillProficiencies,
  getRaceSkillProficiencies,
  getClassSavingThrowProficiencies,
  type SkillModifiers,
  type SavingThrowModifiers,
} from './character-proficiency-calculations';

import type { Character, CharacterClass } from '@/types/character';

import {
  SKILLS_MAP,
  calculateProficiencyBonus,
  calculateHitPoints,
  calculateArmorClass,
  calculateCarryingCapacity,
} from '@/utils/character/basic-math';

/**
 * Comprehensive D&D 5e character calculations utility
 * Automates all the math needed for a character sheet
 */
export interface CharacterStats {
  // Core Stats
  proficiencyBonus: number;
  hitPoints: number;
  hitDie: string;
  armorClass: number;
  initiative: number;
  speed: number;

  // Spellcasting (if applicable)
  spellSaveDC?: number;
  spellAttackBonus?: number;
  spellcastingAbility?: string;
  spellSlots?: { [level: number]: number };

  // Skills & Proficiencies
  skillModifiers: SkillModifiers;
  savingThrowModifiers: SavingThrowModifiers;

  // Combat
  carryingCapacity: number;
  passivePerception: number;
  passiveInvestigation: number;
  passiveInsight: number;

  // Combined race/subrace data
  allTraits: string[];
  allLanguages: string[];
}

// Re-export basic calculations for backward compatibility
export {
  SKILLS_MAP,
  calculateProficiencyBonus,
  calculateHitPoints,
  calculateArmorClass,
  calculateCarryingCapacity,
};

// Re-export proficiency calculations for backward compatibility
export {
  calculateSkillModifiers,
  calculateSavingThrowModifiers,
  getClassSkillProficiencies,
  getRaceSkillProficiencies,
  getClassSavingThrowProficiencies,
};

/**
 * Calculate spell save DC for spellcasters
 * ⚡ Bolt: Added optional profBonus and ability to avoid redundant calculations.
 */
export const calculateSpellSaveDC = (
  character: Character,
  profBonus?: number,
  spellcastingAbility?: keyof Character['abilityScores'] | null,
): number | undefined => {
  const ability =
    spellcastingAbility !== undefined
      ? spellcastingAbility
      : getSpellcastingAbility(character.class);
  if (!ability) {
    return undefined;
  }

  const abilityMod = character.abilityScores?.[ability]?.modifier || 0;
  const pb = profBonus !== undefined ? profBonus : calculateProficiencyBonus(character.level || 1);

  return 8 + pb + abilityMod;
};

/**
 * Calculate spell attack bonus for spellcasters
 * ⚡ Bolt: Added optional profBonus and ability to avoid redundant calculations.
 */
export const calculateSpellAttackBonus = (
  character: Character,
  profBonus?: number,
  spellcastingAbility?: keyof Character['abilityScores'] | null,
): number | undefined => {
  const ability =
    spellcastingAbility !== undefined
      ? spellcastingAbility
      : getSpellcastingAbility(character.class);
  if (!ability) {
    return undefined;
  }

  const abilityMod = character.abilityScores?.[ability]?.modifier || 0;
  const pb = profBonus !== undefined ? profBonus : calculateProficiencyBonus(character.level || 1);

  return pb + abilityMod;
};

/**
 * Get spellcasting ability for a class
 */
export const getSpellcastingAbility = (
  characterClass: CharacterClass | null,
): keyof Character['abilityScores'] | null => {
  if (!characterClass) {
    return null;
  }

  return SPELLCASTING_ABILITY_MAP[characterClass.name] || null;
};

/**
 * Calculate spell slots for a character (simplified, full casters only)
 */
export const calculateSpellSlots = (
  character: Character,
): { [level: number]: number } | undefined => {
  const spellcastingAbility = getSpellcastingAbility(character.class);
  if (!spellcastingAbility) {
    return undefined;
  }

  const level = character.level || 1;

  const slots = FULL_CASTER_SLOTS_MAP[level];
  if (!slots) {
    return undefined;
  }

  const spellSlots: { [level: number]: number } = {};
  slots.forEach((count: number, index: number) => {
    spellSlots[index + 1] = count;
  });

  return spellSlots;
};

/**
 * Calculate passive perception
 * ⚡ Bolt: Added optional skillMods to avoid redundant O(N) calculateSkillModifiers calls.
 */
export const calculatePassivePerception = (
  character: Character,
  skillMods?: SkillModifiers,
): number => {
  const mods = skillMods || calculateSkillModifiers(character);
  return 10 + (mods['Perception']?.modifier || 0);
};

/**
 * Calculate all character stats at once
 * ⚡ Bolt: Optimized by extracting shared values and eliminating redundant sub-calls.
 * This reduces execution time by avoiding multiple O(N) skill calculations and repeated O(1) lookups.
 */
export const calculateAllCharacterStats = (character: Character): CharacterStats => {
  const level = character.level || 1;
  const pb = calculateProficiencyBonus(level);
  const spellcastingAbility = getSpellcastingAbility(character.class);

  // Combined traits from race and subrace
  const allTraits = [...(character.race?.traits || []), ...(character.subrace?.traits || [])];

  // Combined languages from race and subrace (remove duplicates)
  const allLanguages = [
    ...new Set([...(character.race?.languages || []), ...(character.subrace?.languages || [])]),
  ];

  const skillMods = calculateSkillModifiers(character, pb);

  return {
    proficiencyBonus: pb,
    hitPoints: calculateHitPoints(character),
    hitDie: `1d${character.class?.hitDie || 8}`,
    armorClass: calculateArmorClass(character),
    initiative: character.abilityScores?.dexterity?.modifier || 0,
    speed: character.subrace?.speed || character.race?.speed || 30,

    spellSaveDC: calculateSpellSaveDC(character, pb, spellcastingAbility),
    spellAttackBonus: calculateSpellAttackBonus(character, pb, spellcastingAbility),
    spellcastingAbility: spellcastingAbility || undefined,
    spellSlots: calculateSpellSlots(character),

    skillModifiers: skillMods,
    savingThrowModifiers: calculateSavingThrowModifiers(character, pb),

    carryingCapacity: calculateCarryingCapacity(character),
    passivePerception: calculatePassivePerception(character, skillMods),
    passiveInvestigation: 10 + (skillMods['Investigation']?.modifier || 0),
    passiveInsight: 10 + (skillMods['Insight']?.modifier || 0),

    // Additional combined data for future use
    allTraits,
    allLanguages,
  };
};
