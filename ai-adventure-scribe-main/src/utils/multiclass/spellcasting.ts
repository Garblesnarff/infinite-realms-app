/**
 * Multiclassing Spellcasting Calculation for D&D 5e
 * Extracted from src/utils/multiclassing.ts
 */

import type { Character } from '@/types/character';

// #617: spell-slot tables live in shared/spell-slot-tables.ts (epic #616).
import { FULL_CASTER_SLOTS } from '../../../shared/spell-slot-tables';

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
 * Calculate spell slots based on caster level.
 * #617: the table lives in shared/spell-slot-tables.ts (epic #616).
 */
function calculateSpellSlots(casterLevel: number): number[] {
  if (casterLevel <= 0) return [];

  // Official Multiclass Spellcaster table (PHB pg. 165)
  const slots = FULL_CASTER_SLOTS[casterLevel] ?? FULL_CASTER_SLOTS[20];
  // Trim trailing zeros to preserve the legacy short-array shape.
  let end = slots.length;
  while (end > 0 && slots[end - 1] === 0) end--;
  return slots.slice(0, end);
}
