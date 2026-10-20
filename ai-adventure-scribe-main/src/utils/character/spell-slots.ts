import type { Character } from '@/types/character';

export const parseSpellSlots = (value: unknown): Character['spellSlots'] | undefined => {
  if (value == null) return undefined;

  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return undefined;
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;

  const slots = Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>)
      .map(([level, rawSlot]) => {
        const numericLevel = Number(level);
        if (
          !Number.isInteger(numericLevel) ||
          numericLevel < 1 ||
          numericLevel > 9 ||
          !rawSlot ||
          typeof rawSlot !== 'object' ||
          Array.isArray(rawSlot)
        ) {
          return null;
        }

        const slot = rawSlot as { max?: unknown; current?: unknown };
        const max = typeof slot.max === 'number' ? slot.max : null;
        const current = typeof slot.current === 'number' ? slot.current : max;
        if (max == null || current == null || max < 0 || current < 0 || current > max) {
          return null;
        }

        return [numericLevel, { max, current }] as const;
      })
      .filter(
        (entry): entry is readonly [number, { max: number; current: number }] => entry !== null,
      ),
  );

  return Object.keys(slots).length > 0 ? (slots as Character['spellSlots']) : undefined;
};
