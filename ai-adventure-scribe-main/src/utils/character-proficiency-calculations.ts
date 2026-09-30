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
import {
  buildProficiencyKeySet,
  canonicalProficiencyKey,
} from '@/utils/character/parse-proficiency-list';

export interface SkillModifiers {
  [skill: string]: { modifier: number; proficient: boolean; expertise: boolean };
}

export interface SavingThrowModifiers {
  [ability: string]: { modifier: number; proficient: boolean };
}

// ⚡ Bolt: Module-level caches for static proficiency data to avoid redundant
// array copies and Set creation on every calculation. This significantly reduces
// garbage collection pressure and CPU cycles during character stat recalculations.
const classSkillCache = new Map<string, string[]>();
const combinedProficiencySetCache = new Map<string, Set<string>>();
const raceProficiencyCache = new Map<string, string[]>();
const classSavingThrowCache = new Map<string, string[]>();
const savingThrowSetCache = new Map<string, Set<string>>();

/**
 * Calculate skill modifiers for all skills
 * ⚡ Bolt: Optimized by caching the combined proficiency Set for each class/race combination.
 * This eliminates the O(N) cost of merging arrays and creating a new Set on every render.
 */
export const calculateSkillModifiers = (
  character: Character,
  profBonus?: number,
): SkillModifiers => {
  const pb = profBonus !== undefined ? profBonus : calculateProficiencyBonus(character.level || 1);

  // Character creation persists the complete set (class choices, background,
  // race, and other bonuses). Prefer it whenever it is available.
  // Both sides of the membership test are canonicalised (lowercase,
  // non-alphanumerics dropped) so the two writers' disagreeing cases both
  // resolve against the TitleCase SKILLS_MAP keys. See #1847.
  const chosenProficiencies = character.skillProficiencies;
  const expertiseSet = buildProficiencyKeySet(character.expertiseProficiencies);
  const cacheKey = chosenProficiencies
    ? `chosen:${[...buildProficiencyKeySet(chosenProficiencies)].sort().join('|')}`
    : `${character.class?.name || 'none'}:${character.race?.name || 'none'}:${character.subrace?.name || 'none'}`;
  let profSet = combinedProficiencySetCache.get(cacheKey);

  if (!profSet) {
    const sources = chosenProficiencies
      ? chosenProficiencies
      : [
          ...getClassSkillProficiencies(character.class),
          ...getRaceSkillProficiencies(character.race, character.subrace),
        ];
    profSet = buildProficiencyKeySet(sources);
    combinedProficiencySetCache.set(cacheKey, profSet);
  }

  const skillMods: SkillModifiers = {};

  Object.entries(SKILLS_MAP).forEach(([skill, ability]) => {
    const skillKey = canonicalProficiencyKey(skill);
    const abilityMod = character.abilityScores?.[ability]?.modifier || 0;
    const proficient = profSet?.has(skillKey) ?? false;
    const expertise = proficient && expertiseSet.has(skillKey);

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
 * ⚡ Bolt: Optimized with a module-level cache to avoid redundant array copies.
 */
export const getClassSkillProficiencies = (
  characterClass: CharacterClass | null | undefined,
): string[] => {
  if (!characterClass) {
    return [];
  }

  const cached = classSkillCache.get(characterClass.name);
  if (cached) return [...cached];

  const profs = CLASS_SKILL_PROFICIENCIES_MAP[characterClass.name];
  // Return a copy to prevent accidental mutation of the shared map and cache
  const result = profs ? [...profs] : [];
  classSkillCache.set(characterClass.name, result);
  return [...result];
};

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
 * ⚡ Bolt: Optimized by caching the saving throw Set per class.
 * This reduces execution time by avoiding redundant Set allocations.
 */
export const calculateSavingThrowModifiers = (
  character: Character,
  profBonus?: number,
): SavingThrowModifiers => {
  const pb = profBonus !== undefined ? profBonus : calculateProficiencyBonus(character.level || 1);

  const className = character.class?.name || 'none';

  // Character creation persists the class's save proficiencies on the
  // character. Prefer them: the class fallback map below only covers four of
  // the twelve classes, so a Monk (or Barbarian, Bard, Druid, Paladin, Ranger,
  // Sorcerer, Warlock) resolved to an empty set and lost its proficiency bonus
  // on every saving throw (issue #1827).
  const persisted = character.savingThrowProficiencies ?? [];
  const cacheKey =
    persisted.length > 0 ? `chosen:${[...persisted].sort().join('|')}` : `class:${className}`;

  let profSet = savingThrowSetCache.get(cacheKey);

  if (!profSet) {
    profSet = new Set(
      persisted.length > 0
        ? persisted.map((ability) => String(ability).toLowerCase())
        : getClassSavingThrowProficiencies(character.class),
    );
    savingThrowSetCache.set(cacheKey, profSet);
  }

  const savingThrows: SavingThrowModifiers = {};

  if (character.abilityScores) {
    Object.entries(character.abilityScores).forEach(([ability, data]) => {
      const proficient = profSet?.has(ability) ?? false;
      // An ability entry may lack its persisted modifier; derive it from the
      // score instead of yielding NaN from `undefined + pb` (#2343 C7).
      const baseMod = data.modifier ?? Math.floor(((data.score ?? 10) - 10) / 2);
      savingThrows[ability] = {
        modifier: baseMod + (proficient ? pb : 0),
        proficient,
      };
    });
  }

  return savingThrows;
};

/**
 * Get saving throw proficiencies for a class
 * ⚡ Bolt: Optimized with a module-level cache to avoid redundant array copies.
 */
export const getClassSavingThrowProficiencies = (
  characterClass: CharacterClass | null | undefined,
): string[] => {
  if (!characterClass) {
    return [];
  }

  const cached = classSavingThrowCache.get(characterClass.name);
  if (cached) return [...cached];

  const profs = CLASS_SAVING_THROW_PROFICIENCIES_MAP[characterClass.name];
  // Return a copy to prevent accidental mutation of the shared map and cache
  const result = profs ? [...profs] : [];
  classSavingThrowCache.set(characterClass.name, result);
  return [...result];
};
