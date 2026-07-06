/**
 * Skill and saving throw proficiency calculations, split out of
 * character-calculations.ts.
 */

import {
  CLASS_SKILL_PROFICIENCIES_MAP,
  RACE_SKILL_PROFICIENCIES_MAP,
  SUBRACE_SKILL_PROFICIENCIES_MAP,
  CLASS_SAVING_THROW_PROFICIENCIES_MAP,
} from './character-calculations-data';

import type { Character, CharacterClass, CharacterRace, Subrace } from '@/types/character';

import { SKILLS_MAP, calculateProficiencyBonus } from '@/utils/character/basic-math';

export interface SkillModifiers {
  [skill: string]: { modifier: number; proficient: boolean; expertise: boolean };
}

export interface SavingThrowModifiers {
  [ability: string]: { modifier: number; proficient: boolean };
}

/**
 * Calculate skill modifiers for all skills
 * ⚡ Bolt: Added optional profBonus to avoid redundant calculations.
 * ⚡ Bolt: Optimized proficiency lookup using a Set.
 */
export const calculateSkillModifiers = (
  character: Character,
  profBonus?: number,
): SkillModifiers => {
  const pb = profBonus !== undefined ? profBonus : calculateProficiencyBonus(character.level || 1);

  // Get class proficiencies (simplified)
  const classProficiencies = getClassSkillProficiencies(character.class);
  const raceProficiencies = getRaceSkillProficiencies(character.race, character.subrace);

  // ⚡ Bolt: Use a Set for O(1) lookups instead of O(N) array includes in the loop.
  const profSet = new Set([...classProficiencies, ...raceProficiencies]);

  const skillMods: SkillModifiers = {};

  Object.entries(SKILLS_MAP).forEach(([skill, ability]) => {
    const abilityMod = character.abilityScores?.[ability]?.modifier || 0;
    const proficient = profSet.has(skill);
    const expertise = false; // Could be enhanced to track expertise

    skillMods[skill] = {
      modifier: abilityMod + (proficient ? pb : 0) + (expertise ? pb : 0),
      proficient,
      expertise,
    };
  });

  return skillMods;
};

/**
 * Get skill proficiencies for a class (simplified)
 */
export const getClassSkillProficiencies = (
  characterClass: CharacterClass | null | undefined,
): string[] => {
  if (!characterClass) {
    return [];
  }

  const profs = CLASS_SKILL_PROFICIENCIES_MAP[characterClass.name];
  // Return a copy to satisfy the mutable return type and prevent accidental mutation of the shared map
  return profs ? [...profs] : [];
};

// ⚡ Bolt: Module-level cache for combined race/subrace proficiencies to avoid
// redundant Set creation and array processing for static data.
const raceProficiencyCache = new Map<string, string[]>();

/**
 * Get skill proficiencies for a race and subrace (combined)
 */
export const getRaceSkillProficiencies = (
  characterRace: CharacterRace | null | undefined,
  characterSubrace: Subrace | null | undefined,
): string[] => {
  if (!characterRace) {
    return [];
  }

  // ⚡ Bolt: Use a composite key to cache combined results.
  const cacheKey = `${characterRace.name}:${characterSubrace?.name || 'none'}`;
  const cached = raceProficiencyCache.get(cacheKey);
  if (cached) return cached;

  const baseProfs = RACE_SKILL_PROFICIENCIES_MAP[characterRace.name] || [];
  const subraceProfs = characterSubrace
    ? SUBRACE_SKILL_PROFICIENCIES_MAP[characterSubrace.name] || []
    : [];

  // Combine and remove duplicates
  const combined = [...new Set([...baseProfs, ...subraceProfs])];
  raceProficiencyCache.set(cacheKey, combined);

  return combined;
};

/**
 * Calculate saving throw modifiers
 * ⚡ Bolt: Added optional profBonus to avoid redundant calculations.
 * ⚡ Bolt: Optimized proficiency lookup using a Set for O(1) complexity.
 */
export const calculateSavingThrowModifiers = (
  character: Character,
  profBonus?: number,
): SavingThrowModifiers => {
  const pb = profBonus !== undefined ? profBonus : calculateProficiencyBonus(character.level || 1);
  const classProficiencies = getClassSavingThrowProficiencies(character.class);

  // ⚡ Bolt: Use a Set for O(1) lookups instead of O(N) array includes in the loop.
  const profSet = new Set(classProficiencies);

  const savingThrows: SavingThrowModifiers = {};

  if (character.abilityScores) {
    Object.entries(character.abilityScores).forEach(([ability, data]) => {
      const proficient = profSet.has(ability);
      savingThrows[ability] = {
        modifier: data.modifier + (proficient ? pb : 0),
        proficient,
      };
    });
  }

  return savingThrows;
};

/**
 * Get saving throw proficiencies for a class
 */
export const getClassSavingThrowProficiencies = (
  characterClass: CharacterClass | null | undefined,
): string[] => {
  if (!characterClass) {
    return [];
  }

  const profs = CLASS_SAVING_THROW_PROFICIENCIES_MAP[characterClass.name];
  // Return a copy to satisfy the mutable return type and prevent accidental mutation of the shared map
  return profs ? [...profs] : [];
};
