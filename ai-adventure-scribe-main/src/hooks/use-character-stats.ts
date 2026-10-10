import { useMemo } from 'react';

import type { Character, Ability, AbilityScores } from '@/types/character';
import type { CharacterStats } from '@/utils/character-calculations';

import logger from '@/lib/logger';
import { calculateAllCharacterStats } from '@/utils/character-calculations';

/**
 * ⚡ Bolt: Hoisted constants to module scope to avoid re-allocation during render
 * and optimize lookup performance in character hooks.
 */
const SPELLCASTING_CLASSES = new Set([
  'Wizard',
  'Sorcerer',
  'Warlock',
  'Bard',
  'Cleric',
  'Druid',
  'Paladin',
  'Ranger',
  'Eldritch Knight',
  'Arcane Trickster',
]);

const XP_THRESHOLDS = [
  0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000,
  195000, 225000, 265000, 305000, 355000,
];

/**
 * Hook for calculating and memoizing character statistics
 * Provides real-time D&D 5e calculations for character sheets
 */
export const useCharacterStats = (character: Character | null): CharacterStats | null => {
  const effectiveAbilityScores = useEffectiveAbilityScores(character);

  return useMemo(() => {
    if (!character || !effectiveAbilityScores) return null;

    try {
      // Create a modified character with effective scores for derived calculations
      const modifiedCharacter = {
        ...character,
        abilityScores: effectiveAbilityScores as AbilityScores,
      };

      return calculateAllCharacterStats(modifiedCharacter);
    } catch (error) {
      logger.error('Error calculating character stats:', error);
      return null;
    }
  }, [character, effectiveAbilityScores]);
};

/**
 * Hook for getting specific calculated values from character stats
 * Useful for components that only need a few values
 */
export const useCharacterStatValue = <K extends keyof CharacterStats>(
  character: Character | null,
  statKey: K,
): CharacterStats[K] | null => {
  const stats = useCharacterStats(character);
  return stats ? stats[statKey] : null;
};

/**
 * Hook for checking if a character is a spellcaster
 */
export const useIsSpellcaster = (character: Character | null): boolean => {
  return useMemo(() => {
    if (!character?.class) return false;
    // ⚡ Bolt: Using Set.has for O(1) lookup complexity instead of O(N).
    return SPELLCASTING_CLASSES.has(character.class.name);
  }, [character?.class]);
};

/**
 * Hook for getting character level progression info
 */
export const useLevelProgression = (character: Character | null) => {
  return useMemo(() => {
    if (!character) return null;

    const currentLevel = character.level || 1;
    const currentXP = character.experience || 0;

    const nextLevelXP = XP_THRESHOLDS[currentLevel] || XP_THRESHOLDS[19];
    const previousLevelXP = XP_THRESHOLDS[currentLevel - 1] || 0;
    const progressXP = currentXP - previousLevelXP;
    const requiredXP = nextLevelXP - previousLevelXP;
    const progressPercent = currentLevel >= 20 ? 100 : (progressXP / requiredXP) * 100;

    return {
      currentLevel,
      currentXP,
      nextLevelXP,
      previousLevelXP,
      progressXP,
      requiredXP,
      progressPercent,
      canLevelUp: currentXP >= nextLevelXP && currentLevel < 20,
      isMaxLevel: currentLevel >= 20,
    };
  }, [character]);
};

/**
 * Hook for getting character's effective ability scores.
 *
 * Stored scores are final: racial bonuses are applied once, at creation
 * (see applyRacialBonusesToAbilityScores). Reads must not add them again, or
 * every reload double-counts. racialBonus is therefore always 0 here.
 */
export const useEffectiveAbilityScores = (character: Character | null) => {
  return useMemo(() => {
    if (!character?.abilityScores) return null;

    const finalScores = character.abilityScores;

    const effectiveScores = (
      Object.entries(finalScores) as [keyof AbilityScores, Ability][]
    ).reduce(
      (acc, [ability, data]) => {
        acc[ability] = {
          ...data,
          baseScore: data.score,
          racialBonus: 0,
        };

        return acc;
      },
      {} as Record<keyof AbilityScores, Ability & { baseScore: number; racialBonus: number }>,
    );

    return effectiveScores;
  }, [character?.abilityScores]);
};
