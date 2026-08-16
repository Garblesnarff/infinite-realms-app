export function parseOptionalBoundedInteger(
  value: string | undefined,
  minimum: number,
  maximum: number,
): number | undefined | null {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) return null;

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) return null;

  return parsed;
}
