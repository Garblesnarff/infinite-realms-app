/**
 * Spell Management Utilities
 *
 * Provides functions for D&D 5e spell slot calculations, management, and casting mechanics.
 * Based on PHB rules for spellcasting classes. Handles multiclassing by summing slots from all classes.
 *
 * Dependencies:
 * - Character types from '@/types/character'
 * - Combat types from '@/types/combat'
 * - classOptions and spellOptions from '@/data/'
 *
 * @author Cline
 */

// ===========================
// Imports
// ===========================

import type { Character } from '@/types/character';

import { fullCasterProgression, type SpellSlotLevel } from '@/utils/spell-slots-table';

export * from './combat/spellcasting-actions';

// ===========================
// Type Helpers
// ===========================

export type { SpellSlotLevel };

/**
 * Spell slot configuration for a single level
 */
export interface SpellSlotConfig {
  max: number;
  current: number;
}

/**
 * Calculates spell slots for a single class at a given level
 * Uses hardcoded PHB progression tables
 * @param className - The class name (e.g., 'wizard', 'cleric')
 * @param level - Character level in this class
 * @returns Spell slot counts per level
 */
function calculateClassSpellSlots(
  _className: string,
  level: number,
): Partial<Record<SpellSlotLevel, number>> {
  return fullCasterProgression[level] || { 1: 0 };
}

/**
 * Calculates total spell slots for a character, handling multiclassing
 * Sums slots from all classes, caps at multiclass spellcasting rules (half non-full caster levels)
 * @param character - The character object
 * @returns Spell slots record for levels 1-9
 */
export function calculateSpellSlots(character: Character): Record<SpellSlotLevel, SpellSlotConfig> {
  if (!character.classLevels || character.classLevels.length === 0) {
    return {
      1: { max: 0, current: 0 },
      2: { max: 0, current: 0 },
      3: { max: 0, current: 0 },
      4: { max: 0, current: 0 },
      5: { max: 0, current: 0 },
      6: { max: 0, current: 0 },
      7: { max: 0, current: 0 },
      8: { max: 0, current: 0 },
      9: { max: 0, current: 0 },
    };
  }

  const totalSlots: Partial<Record<SpellSlotLevel, number>> = {};

  // Determine caster levels
  let fullCasterLevels = 0;
  let halfCasterLevels = 0;
  const isMulticlass = character.classLevels.length > 1;

  character.classLevels.forEach((classLevel) => {
    const className = classLevel.className.toLowerCase();

    // Check for full casters
    if (['wizard', 'cleric', 'druid', 'sorcerer', 'bard'].includes(className)) {
      fullCasterLevels += classLevel.level;
    }
    // Check for half casters (Paladin, Ranger)
    else if (['paladin', 'ranger'].includes(className)) {
      if (isMulticlass) {
        halfCasterLevels += Math.floor(classLevel.level / 2);
      } else {
        // Single class half casters get slots at level 2
        // Their progression effectively matches full caster table at ceil(level/2)
        // e.g. Paladin 2 -> FC 1, Paladin 5 -> FC 3
        if (classLevel.level >= 2) {
          halfCasterLevels += Math.ceil(classLevel.level / 2);
        }
      }
    }
    // Warlocks use Pact Magic and are handled separately in D&D,
    // and don't contribute to the multiclass spellcasting table.
  });

  const effectiveCasterLevel = Math.min(fullCasterLevels + halfCasterLevels, 20);

  // Use effective level to get slots from the unified table
  const classSlots = calculateClassSpellSlots('', effectiveCasterLevel);

  // Initialize total slots
  for (let i = 1; i <= 9; i++) {
    totalSlots[i as SpellSlotLevel] = classSlots[i as SpellSlotLevel] || 0;
  }

  // Ensure current doesn't exceed max
  const slots: Record<SpellSlotLevel, SpellSlotConfig> = {} as Record<
    SpellSlotLevel,
    SpellSlotConfig
  >;
  for (let i = 1; i <= 9; i++) {
    const max = totalSlots[i as SpellSlotLevel] || 0;
    const currentFromChar = character.spellSlots?.[i as SpellSlotLevel]?.current;
    slots[i as SpellSlotLevel] = {
      max,
      current: Math.min(max, currentFromChar !== undefined ? currentFromChar : max),
    };
  }

  return slots;
}

/**
 * Deducts a spell slot of the given level
 * @param character - Character to update
 * @param level - Spell level to deduct (1-9)
 * @returns Updated character with deducted slot
 */
export function deductSpellSlot(character: Character, level: SpellSlotLevel): Character {
  if (!character.spellSlots || character.spellSlots[level]?.current <= 0) {
    throw new Error(`No available spell slots at level ${level}`);
  }

  const updatedSlots = { ...character.spellSlots };
  updatedSlots[level] = { ...updatedSlots[level], current: updatedSlots[level].current - 1 };

  return { ...character, spellSlots: updatedSlots };
}

/**
 * Restores all spell slots to maximum (called on long rest)
 * @param character - Character to restore
 * @returns Updated character with full slots
 */
export function restoreSpellSlots(character: Character): Character {
  const maxSlots = calculateSpellSlots(character);
  const updatedSlots: Record<SpellSlotLevel, SpellSlotConfig> = {} as Record<
    SpellSlotLevel,
    SpellSlotConfig
  >;

  for (let i = 1; i <= 9; i++) {
    updatedSlots[i as SpellSlotLevel] = {
      ...maxSlots[i as SpellSlotLevel],
      current: maxSlots[i as SpellSlotLevel].max,
    };
  }

  return { ...character, spellSlots: updatedSlots, activeConcentration: null };
}

