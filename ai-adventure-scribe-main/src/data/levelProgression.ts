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

  const checkRequirements = (className: string) => {
    const requirement = multiclassRequirements[className.toLowerCase()];
    if (!requirement) return;

    for (const item of requirement.allOf ?? []) {
      if (abilityScores[item.ability].score < item.minimum) {
        requirements.push(`${className}: ${item.ability} ${item.minimum}+`);
        canMulticlass = false;
      }
    }

    const alternatives = requirement.anyOf ?? [];
    if (
      alternatives.length > 0 &&
      !alternatives.some((item) => abilityScores[item.ability].score >= item.minimum)
    ) {
      requirements.push(
        `${className}: ${alternatives.map((item) => `${item.ability} ${item.minimum}+`).join(' or ')}`,
      );
      canMulticlass = false;
    }
  };

  checkRequirements(currentClass);
  checkRequirements(targetClass);

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
