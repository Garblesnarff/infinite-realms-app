/**
 * Single owner for D&D 5e (2014) spell-slot progression tables (#617, epic #616).
 *
 * Client and server import from here. No other copy of these tables may exist.
 * Values are the 2014 PHB tables; the server's SpellSlotMechanics and every
 * client helper derive from these.
 *
 * Table shape: `Record<class level, readonly number[]>` where index 0 holds
 * 1st-level slots, index 1 holds 2nd-level slots, ... index 8 holds 9th-level
 * slots. A missing level means the class has no spellcasting at that level.
 *
 * @module shared/spell-slot-tables
 */

/** Spell levels 1-9. */
export type SpellSlotLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/**
 * D&D 5E Full Caster Spell Slot Progression (PHB pg. 114).
 * Used by: Wizard, Sorcerer, Cleric, Druid, Bard — and as the base table for
 * half casters (ceil(level/2)), third casters (ceil(level/3), max 4th-level
 * slots) and multiclass combined caster level (PHB pg. 164-165).
 */
export const FULL_CASTER_SLOTS: Record<number, readonly number[]> = {
  1: [2, 0, 0, 0, 0, 0, 0, 0, 0],
  2: [3, 0, 0, 0, 0, 0, 0, 0, 0],
  3: [4, 2, 0, 0, 0, 0, 0, 0, 0],
  4: [4, 3, 0, 0, 0, 0, 0, 0, 0],
  5: [4, 3, 2, 0, 0, 0, 0, 0, 0],
  6: [4, 3, 3, 0, 0, 0, 0, 0, 0],
  7: [4, 3, 3, 1, 0, 0, 0, 0, 0],
  8: [4, 3, 3, 2, 0, 0, 0, 0, 0],
  9: [4, 3, 3, 3, 1, 0, 0, 0, 0],
  10: [4, 3, 3, 3, 2, 0, 0, 0, 0],
  11: [4, 3, 3, 3, 2, 1, 0, 0, 0],
  12: [4, 3, 3, 3, 2, 1, 0, 0, 0],
  13: [4, 3, 3, 3, 2, 1, 1, 0, 0],
  14: [4, 3, 3, 3, 2, 1, 1, 0, 0],
  15: [4, 3, 3, 3, 2, 1, 1, 1, 0],
  16: [4, 3, 3, 3, 2, 1, 1, 1, 0],
  17: [4, 3, 3, 3, 2, 1, 1, 1, 1],
  18: [4, 3, 3, 3, 3, 1, 1, 1, 1],
  19: [4, 3, 3, 3, 3, 2, 1, 1, 1],
  20: [4, 3, 3, 3, 3, 2, 2, 1, 1],
};

/**
 * D&D 5E Warlock Pact Magic Progression (PHB pg. 107).
 * Warlocks use a different system — all slots are the same level.
 */
export const WARLOCK_PACT_MAGIC: Record<number, { readonly slots: number; readonly level: number }> = {
  1: { slots: 1, level: 1 },
  2: { slots: 2, level: 1 },
  3: { slots: 2, level: 2 },
  4: { slots: 2, level: 2 },
  5: { slots: 2, level: 3 },
  6: { slots: 2, level: 3 },
  7: { slots: 2, level: 4 },
  8: { slots: 2, level: 4 },
  9: { slots: 2, level: 5 },
  10: { slots: 2, level: 5 },
  11: { slots: 3, level: 5 },
  12: { slots: 3, level: 5 },
  13: { slots: 3, level: 5 },
  14: { slots: 3, level: 5 },
  15: { slots: 3, level: 5 },
  16: { slots: 3, level: 5 },
  17: { slots: 4, level: 5 },
  18: { slots: 4, level: 5 },
  19: { slots: 4, level: 5 },
  20: { slots: 4, level: 5 },
};

/**
 * Single-class half casters (Paladin, Ranger): spellcasting begins at class
 * level 2; slots follow the full table at ceil(level/2).
 */
export function halfCasterSlots(level: number): readonly number[] {
  if (!Number.isInteger(level) || level < 2) return [];
  return FULL_CASTER_SLOTS[Math.ceil(level / 2)] ?? [];
}

/**
 * Single-class third casters (Eldritch Knight, Arcane Trickster): spellcasting
 * begins at class level 3; slots follow the full table at ceil(level/3),
 * capped at 4th-level spells.
 */
export function thirdCasterSlots(level: number): readonly number[] {
  if (!Number.isInteger(level) || level < 3) return [];
  const slots = FULL_CASTER_SLOTS[Math.ceil(level / 3)] ?? [];
  return slots.slice(0, 4);
}

/**
 * Convert a slot array to a spell-level -> count map, dropping zero counts.
 */
export function slotsToMap(slots: readonly number[]): Partial<Record<SpellSlotLevel, number>> {
  const out: Partial<Record<SpellSlotLevel, number>> = {};
  for (let i = 0; i < slots.length && i < 9; i++) {
    if (slots[i] > 0) out[(i + 1) as SpellSlotLevel] = slots[i];
  }
  return out;
}
