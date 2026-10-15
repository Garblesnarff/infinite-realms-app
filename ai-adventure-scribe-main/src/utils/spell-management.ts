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

// #617: spell-slot tables live in shared/spell-slot-tables.ts (epic #616);
// the single calculateSpellSlots lives in character-calculations.ts.
import { type SpellSlotLevel } from '../../shared/spell-slot-tables';
import { calculateSpellSlots } from './character-calculations';

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
 * #617: merged into character-calculations.ts. This adapter preserves the
 * SpellSlotConfig shape for restoreSpellSlots.
 */
function toSlotConfigs(character: Character): Record<SpellSlotLevel, SpellSlotConfig> {
  const maxMap = calculateSpellSlots(character) ?? {};
  const slots = {} as Record<SpellSlotLevel, SpellSlotConfig>;
  for (let i = 1; i <= 9; i++) {
    const max = maxMap[i] || 0;
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
  const maxSlots = toSlotConfigs(character);
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
