/**
 * Parse a base-10 integer only when the complete input is numeric and the
 * result falls inside the caller's D&D level bounds.
 */
export function parseBoundedSpellLevel(
  value: string,
  minimum: number,
  maximum: number,
): number | null {
  if (!/^\d+$/.test(value)) return null;

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) return null;

  return parsed;
}
