
import {
  experienceTable,
  proficiencyBonusTable,
  multiclassRequirements,
  classProgressions,
  multiclassProficiencies,
} from './progression-data';

import type { LevelFeature } from './progression-data';
import type { AbilityScores } from '@/types/character';

// Re-export constants and types for backward compatibility
export {
  experienceTable,
  proficiencyBonusTable,
  multiclassRequirements,
  classProgressions,
  multiclassProficiencies,
};

export type { LevelFeature };

/**
 * Helper functions for level advancement
 */

export function getExperienceForLevel(level: number): number {
  return experienceTable[level] || 0;
}

export function getLevelFromExperience(experience: number): number {
  for (let level = 20; level >= 1; level--) {
    if (experience >= experienceTable[level]) {
      return level;
    }
  }
  return 1;
}

export function getProficiencyBonus(level: number): number {
  return proficiencyBonusTable[Math.min(20, Math.max(1, level))] || 2;
}

export function canMulticlass(
  currentClass: string,
  targetClass: string,
  abilityScores: Record<keyof AbilityScores, { score: number; modifier: number }>,
): { canMulticlass: boolean; requirements: string[] } {
  const requirements: string[] = [];
  let canMulticlass = true;

  // Check current class requirements (to multiclass OUT of current class)
  const currentReq = multiclassRequirements[currentClass.toLowerCase()];
  if (currentReq) {
    const currentAbility = abilityScores[currentReq.ability];
    if (currentAbility.score < currentReq.minimum) {
      requirements.push(`${currentClass}: ${currentReq.ability} ${currentReq.minimum}+`);
      canMulticlass = false;
    }
  }

  // Check target class requirements (to multiclass INTO target class)
  const targetReq = multiclassRequirements[targetClass.toLowerCase()];
  if (targetReq) {
    const targetAbility = abilityScores[targetReq.ability];
    if (targetAbility.score < targetReq.minimum) {
      requirements.push(`${targetClass}: ${targetReq.ability} ${targetReq.minimum}+`);
      canMulticlass = false;
    }
  }

  // Special cases for classes with multiple requirements
  if (targetClass.toLowerCase() === 'monk') {
    const wisdom = abilityScores.wisdom;
    if (wisdom.score < 13) {
      requirements.push(`Monk: Wisdom 13+`);
      canMulticlass = false;
    }
  }

  if (targetClass.toLowerCase() === 'paladin') {
    const charisma = abilityScores.charisma;
    if (charisma.score < 13) {
      requirements.push(`Paladin: Charisma 13+`);
      canMulticlass = false;
    }
  }

  if (targetClass.toLowerCase() === 'ranger') {
    const wisdom = abilityScores.wisdom;
    if (wisdom.score < 13) {
      requirements.push(`Ranger: Wisdom 13+`);
      canMulticlass = false;
    }
  }

  return { canMulticlass, requirements };
}

export function getClassFeaturesForLevel(className: string, level: number): LevelFeature[] {
  const classProgression = classProgressions[className.toLowerCase()] || [];
  return classProgression.filter((feature) => feature.level === level);
}

export function getAllClassFeaturesUpToLevel(className: string, level: number): LevelFeature[] {
  const classProgression = classProgressions[className.toLowerCase()] || [];
  return classProgression.filter((feature) => feature.level <= level);
}

export function getMulticlassProficiencies(className: string) {
  return multiclassProficiencies[className.toLowerCase()] || {};
}
