/**
 * Multiclassing Validation for D&D 5e
 * Extracted from src/utils/multiclassing.ts
 */

import type { Character, CharacterClass } from '@/types/character';

import { multiclassRequirements } from '@/data/levelProgression';

export interface MulticlassValidationResult {
  canMulticlass: boolean;
  requirements: string[];
  missingRequirements: string[];
}

/**
 * Validate if a character can multiclass into a new class
 */
export function validateMulticlass(
  character: Character,
  newClass: CharacterClass,
): MulticlassValidationResult {
  const requirements: string[] = [];
  const missingRequirements: string[] = [];
  let canMulticlass = true;

  if (!character.abilityScores) {
    return { canMulticlass, requirements, missingRequirements };
  }

  const abilityScores = character.abilityScores;

  // Helper to check requirements for a class
  const checkClassReqs = (className: string): void => {
    const nameLower = className.toLowerCase();
    const classReq = multiclassRequirements[nameLower];

    if (classReq) {
      for (const requirement of classReq.allOf ?? []) {
        const abilityScore = abilityScores[requirement.ability];
        if (abilityScore.score >= requirement.minimum) continue;
        const reqText = `${className}: ${requirement.ability.charAt(0).toUpperCase() + requirement.ability.slice(1)} ${requirement.minimum}+`;
        requirements.push(reqText);
        missingRequirements.push(reqText);
        canMulticlass = false;
      }

      const alternatives = classReq.anyOf ?? [];
      if (
        alternatives.length > 0 &&
        !alternatives.some((item) => abilityScores[item.ability].score >= item.minimum)
      ) {
        const reqText = `${className}: ${alternatives
          .map(
            (item) =>
              `${item.ability.charAt(0).toUpperCase() + item.ability.slice(1)} ${item.minimum}+`,
          )
          .join(' or ')}`;
        requirements.push(reqText);
        missingRequirements.push(reqText);
        canMulticlass = false;
      }
    }
  };

  // Check requirements for all EXISTING classes (multiclassing OUT)
  if (character.classLevels && character.classLevels.length > 0) {
    character.classLevels.forEach((cls) => {
      checkClassReqs(cls.className);
    });
  } else if (character.class) {
    checkClassReqs(character.class.name);
  }

  // Check requirements for NEW class (multiclassing INTO)
  checkClassReqs(newClass.name);

  // Remove duplicates from requirements/missingRequirements
  return {
    canMulticlass,
    requirements: [...new Set(requirements)],
    missingRequirements: [...new Set(missingRequirements)],
  };
}
