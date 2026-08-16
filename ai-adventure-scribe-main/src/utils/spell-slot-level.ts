const MIN_SPELL_SLOT_LEVEL = 0;
const MAX_SPELL_SLOT_LEVEL = 9;

/** Parse a complete D&D spell-slot level without accepting partial numeric keys. */
export function parseSpellSlotLevel(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;

  const level = Number(value);
  return Number.isSafeInteger(level) &&
    level >= MIN_SPELL_SLOT_LEVEL &&
    level <= MAX_SPELL_SLOT_LEVEL
    ? level
    : null;
}
