/**
 * Multiclassing Utilities for D&D 5e
 *
 * Functions for handling multiclassing rules, calculations, and validations
 */

import type { AbilityScores, Character, CharacterClass, ClassFeature } from '@/types/character';

import {
  multiclassRequirements,
  multiclassProficiencies,
  getAllClassFeaturesUpToLevel,
} from '@/data/levelProgression';

// ===========================
// Multiclassing Data Models
// ===========================

export interface MulticlassValidationResult {
  canMulticlass: boolean;
  requirements: string[];
  missingRequirements: string[];
}

export interface MulticlassProficiencyResult {
  armor: string[];
  weapons: string[];
  tools: string[];
  savingThrows: (keyof AbilityScores)[];
  skillChoices: string[];
  numSkillChoices: number;
}

export interface MulticlassSpellcastingResult {
  spellcastingClasses: Array<{
    className: string;
    level: number;
    casterType: 'full' | 'half' | 'third' | 'pact';
  }>;
  combinedCasterLevel: number;
  spellSlots: number[];
}

// ===========================
// Multiclassing Validation
// ===========================

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
      const abilityScore = abilityScores[classReq.ability];
      if (abilityScore.score < classReq.minimum) {
        const reqText = `${className}: ${classReq.ability.charAt(0).toUpperCase() + classReq.ability.slice(1)} ${classReq.minimum}+`;
        requirements.push(reqText);
        missingRequirements.push(reqText);
        canMulticlass = false;
      }
    }

    // Special cases for classes with multiple requirements
    if (nameLower === 'monk') {
      if (abilityScores.wisdom.score < 13) {
        const reqText = 'Monk: Wisdom 13+';
        requirements.push(reqText);
        missingRequirements.push(reqText);
        canMulticlass = false;
      }
    } else if (nameLower === 'paladin') {
      if (abilityScores.charisma.score < 13) {
        const reqText = 'Paladin: Charisma 13+';
        requirements.push(reqText);
        missingRequirements.push(reqText);
        canMulticlass = false;
      }
    } else if (nameLower === 'ranger') {
      if (abilityScores.wisdom.score < 13) {
        const reqText = 'Ranger: Wisdom 13+';
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

// ===========================
// Proficiency Calculations
// ===========================

/**
 * Calculate combined proficiencies for a multiclass character
 */
export function calculateMulticlassProficiencies(
  character: Character,
): MulticlassProficiencyResult {
  const result: MulticlassProficiencyResult = {
    armor: [],
    weapons: [],
    tools: [],
    savingThrows: [],
    skillChoices: [],
    numSkillChoices: 0,
  };

  // Track what we've already added to avoid duplicates
  const addedArmor = new Set<string>();
  const addedWeapons = new Set<string>();
  const addedTools = new Set<string>();
  const addedSavingThrows = new Set<keyof AbilityScores>();

  // Add proficiencies from first class
  if (character.class) {
    const firstClassProfs = multiclassProficiencies[character.class.name.toLowerCase()] || {};

    // Add armor proficiencies
    if (firstClassProfs.armor) {
      firstClassProfs.armor.forEach((armor) => {
        if (!addedArmor.has(armor)) {
          result.armor.push(armor);
          addedArmor.add(armor);
        }
      });
    }

    // Add weapon proficiencies
    if (firstClassProfs.weapons) {
      firstClassProfs.weapons.forEach((weapon) => {
        if (!addedWeapons.has(weapon)) {
          result.weapons.push(weapon);
          addedWeapons.add(weapon);
        }
      });
    }

    // Add tool proficiencies
    if (firstClassProfs.tools) {
      firstClassProfs.tools.forEach((tool) => {
        if (!addedTools.has(tool)) {
          result.tools.push(tool);
          addedTools.add(tool);
        }
      });
    }

    // Add saving throw proficiencies from first class
    if (character.class.savingThrowProficiencies) {
      character.class.savingThrowProficiencies.forEach((st) => {
        if (!addedSavingThrows.has(st)) {
          result.savingThrows.push(st);
          addedSavingThrows.add(st);
        }
      });
    }

    // Add skill choices from first class
    if (firstClassProfs.skillChoices) {
      result.skillChoices = [...firstClassProfs.skillChoices];
      result.numSkillChoices = firstClassProfs.numSkillChoices || 0;
    }
  }

  // Add proficiencies from additional classes
  if (character.classLevels && character.classLevels.length > 1) {
    // Skip first class (already processed)
    for (let i = 1; i < character.classLevels.length; i++) {
      const classLevel = character.classLevels[i];
      const classProfs = multiclassProficiencies[classLevel.className.toLowerCase()] || {};

      // Add armor proficiencies
      if (classProfs.armor) {
        classProfs.armor.forEach((armor) => {
          if (!addedArmor.has(armor)) {
            result.armor.push(armor);
            addedArmor.add(armor);
          }
        });
      }

      // Add weapon proficiencies
      if (classProfs.weapons) {
        classProfs.weapons.forEach((weapon) => {
          if (!addedWeapons.has(weapon)) {
            result.weapons.push(weapon);
            addedWeapons.add(weapon);
          }
        });
      }

      // Add tool proficiencies
      if (classProfs.tools) {
        classProfs.tools.forEach((tool) => {
          if (!addedTools.has(tool)) {
            result.tools.push(tool);
            addedTools.add(tool);
          }
        });
      }
    }
  }

  return result;
}

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
// Spellcasting Calculation
// ===========================

/**
 * Calculate spellcasting for a multiclass character
 */
export function calculateMulticlassSpellcasting(
  character: Character,
): MulticlassSpellcastingResult {
  const result: MulticlassSpellcastingResult = {
    spellcastingClasses: [],
    combinedCasterLevel: 0,
    spellSlots: [],
  };

  if (!character.classLevels || character.classLevels.length === 0) {
    return result;
  }

  // Identify spellcasting classes
  character.classLevels.forEach((classLevel) => {
    let casterType: 'full' | 'half' | 'third' | 'pact' | null = null;

    switch (classLevel.className.toLowerCase()) {
      // Full casters
      case 'bard':
      case 'cleric':
      case 'druid':
      case 'sorcerer':
      case 'wizard':
        casterType = 'full';
        break;

      // Half casters
      case 'paladin':
      case 'ranger':
        casterType = 'half';
        break;

      // Third casters
      case 'fighter':
      case 'rogue':
        // Note: Only Eldritch Knight and Arcane Trickster are third casters.
        // In SRD, Fighter/Rogue don't have spellcasting by default.
        // We include this for future expansion and to handle third-party classes.
        casterType = 'third';
        break;

      // Pact casters
      case 'warlock':
        casterType = 'pact';
        break;
    }

    if (casterType) {
      result.spellcastingClasses.push({
        className: classLevel.className,
        level: classLevel.level,
        casterType,
      });
    }
  });

  // Calculate combined caster level (excluding Warlocks for standard spell slots)
  let combinedCasterLevel = 0;

  result.spellcastingClasses.forEach((spellClass) => {
    if (spellClass.casterType === 'pact') {
      // Warlocks don't contribute to combined spell slots
      return;
    }

    switch (spellClass.casterType) {
      case 'full':
        combinedCasterLevel += spellClass.level;
        break;
      case 'half':
        combinedCasterLevel += Math.floor(spellClass.level / 2);
        break;
      case 'third':
        combinedCasterLevel += Math.floor(spellClass.level / 3);
        break;
    }
  });

  result.combinedCasterLevel = combinedCasterLevel;

  // Calculate spell slots based on combined caster level
  result.spellSlots = calculateSpellSlots(combinedCasterLevel);

  return result;
}

/**
 * Calculate spell slots based on caster level
 */
function calculateSpellSlots(casterLevel: number): number[] {
  if (casterLevel <= 0) return [];

  // Official Multiclass Spellcaster table
  const table: Record<number, number[]> = {
    1: [2],
    2: [3],
    3: [4, 2],
    4: [4, 3],
    5: [4, 3, 2],
    6: [4, 3, 3],
    7: [4, 3, 3, 1],
    8: [4, 3, 3, 2],
    9: [4, 3, 3, 3, 1],
    10: [4, 3, 3, 3, 2],
    11: [4, 3, 3, 3, 2, 1],
    12: [4, 3, 3, 3, 2, 1],
    13: [4, 3, 3, 3, 2, 1, 1],
    14: [4, 3, 3, 3, 2, 1, 1],
    15: [4, 3, 3, 3, 2, 1, 1, 1],
    16: [4, 3, 3, 3, 2, 1, 1, 1],
    17: [4, 3, 3, 3, 2, 1, 1, 1, 1],
    18: [4, 3, 3, 3, 3, 1, 1, 1, 1],
    19: [4, 3, 3, 3, 3, 2, 1, 1, 1],
    20: [4, 3, 3, 3, 3, 2, 2, 1, 1],
  };

  return table[casterLevel] || table[20];
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
