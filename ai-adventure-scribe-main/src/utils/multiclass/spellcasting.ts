/**
 * Multiclassing Spellcasting Calculation for D&D 5e
 * Extracted from src/utils/multiclassing.ts
 */

import type { Character } from '@/types/character';

export interface MulticlassSpellcastingResult {
  spellcastingClasses: Array<{
    className: string;
    level: number;
    casterType: 'full' | 'half' | 'third' | 'pact';
  }>;
  combinedCasterLevel: number;
  spellSlots: number[];
}

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
