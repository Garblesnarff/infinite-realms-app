/**
 * Multiclassing Utilities for D&D 5e
 *
 * Functions for handling multiclassing rules, calculations, and validations
 */

import { calculateMulticlassProficiencies } from './multiclass/proficiencies';
import { calculateMulticlassSpellcasting } from './multiclass/spellcasting';
import { validateMulticlass } from './multiclass/validation';

import type { MulticlassProficiencyResult } from './multiclass/proficiencies';
import type { MulticlassSpellcastingResult } from './multiclass/spellcasting';
import type { MulticlassValidationResult } from './multiclass/validation';
import type { Character, CharacterClass, ClassFeature } from '@/types/character';

import { getAllClassFeaturesUpToLevel } from '@/data/levelProgression';

// Re-export spellcasting, proficiency, and validation types/functions for backward compatibility
export type {
  MulticlassSpellcastingResult,
  MulticlassProficiencyResult,
  MulticlassValidationResult,
};
export {
  calculateMulticlassSpellcasting,
  calculateMulticlassProficiencies,
  validateMulticlass,
};

// ===========================
// Hit Points Calculation
// ===========================

/**
 * Calculate hit points for a multiclass character
 */
export function calculateMulticlassHitPoints(character: Character): number {
  if (!character.classLevels || character.classLevels.length === 0) {
    return character.hitPoints?.maximum || 0;
  }

  let totalHP = 0;
  const conModifier = character.abilityScores?.constitution.modifier || 0;

  // For each class, add the appropriate HP based on level
  character.classLevels.forEach((classLevel, index) => {
    const hitDie = classLevel.hitDie;
    const averageHitDie = Math.floor(hitDie / 2) + 1;

    if (index === 0) {
      // First class: Take full hit die + CON at 1st level
      totalHP += hitDie + conModifier;

      // Additional levels in first class: Take average hit die + CON
      if (classLevel.level > 1) {
        totalHP += (averageHitDie + conModifier) * (classLevel.level - 1);
      }
    } else {
      // Additional classes: ALL levels (including their first) take average hit die + CON
      totalHP += (averageHitDie + conModifier) * classLevel.level;
    }
  });

  return Math.max(1, totalHP); // Minimum 1 HP
}

// ===========================
// Class Features Management
// ===========================

/**
 * Get all class features for a multiclass character
 */
export function getMulticlassFeatures(character: Character): ClassFeature[] {
  if (!character.classLevels || character.classLevels.length === 0) {
    return [];
  }

  const allFeatures: ClassFeature[] = [];

  character.classLevels.forEach((classLevel) => {
    const features = getAllClassFeaturesUpToLevel(classLevel.className, classLevel.level);
    allFeatures.push(...features);
  });

  return allFeatures;
}

// ===========================
// Utility Functions
// ===========================

/**
 * Add a new class to a character (multiclassing)
 */
export function addMulticlass(
  character: Character,
  newClass: CharacterClass,
  levels: number = 1,
): Character {
  const updatedCharacter = { ...character };

  // Initialize classLevels if not present
  if (!updatedCharacter.classLevels) {
    updatedCharacter.classLevels = [];

    // Add current class as first entry
    if (updatedCharacter.class) {
      updatedCharacter.classLevels.push({
        classId: updatedCharacter.class.id,
        className: updatedCharacter.class.name,
        level: updatedCharacter.level || 1,
        hitDie: updatedCharacter.class.hitDie,
        features: updatedCharacter.class.classFeatures.map((f) => f.id),
      });
    }
  }

  // Add new class
  updatedCharacter.classLevels.push({
    classId: newClass.id,
    className: newClass.name,
    level: levels,
    hitDie: newClass.hitDie,
    features: newClass.classFeatures.map((f) => f.id),
  });

  // Update total level
  updatedCharacter.totalLevel = updatedCharacter.classLevels.reduce(
    (sum, cls) => sum + cls.level,
    0,
  );

  // Recalculate hit points
  updatedCharacter.hitPoints = {
    ...updatedCharacter.hitPoints,
    maximum: calculateMulticlassHitPoints(updatedCharacter),
    current: calculateMulticlassHitPoints(updatedCharacter), // Reset current HP on level up/multiclass
    temporary: 0,
  };

  return updatedCharacter;
}

/**
 * Level up a specific class
 */
export function levelUpClass(character: Character, classId: string): Character {
  const updatedCharacter = { ...character };

  if (!updatedCharacter.classLevels) {
    return updatedCharacter;
  }

  // Find and level up the specified class
  updatedCharacter.classLevels = updatedCharacter.classLevels.map((cls) => {
    if (cls.classId === classId) {
      return {
        ...cls,
        level: cls.level + 1,
      };
    }
    return cls;
  });

  // Update total level
  updatedCharacter.totalLevel = updatedCharacter.classLevels.reduce(
    (sum, cls) => sum + cls.level,
    0,
  );

  // Recalculate hit points
  updatedCharacter.hitPoints = {
    ...updatedCharacter.hitPoints,
    maximum: calculateMulticlassHitPoints(updatedCharacter),
    current: calculateMulticlassHitPoints(updatedCharacter),
    temporary: 0,
  };

  return updatedCharacter;
}
