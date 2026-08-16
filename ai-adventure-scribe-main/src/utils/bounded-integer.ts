interface BoundedIntegerOptions {
  fallback: number;
  min: number;
  max: number;
  outOfRange?: 'clamp' | 'fallback';
}

/**
 * Parse an integer without accepting partial numeric strings, then clamp it to
 * an explicit range. Invalid values use the caller-selected safe fallback.
 */
export function parseBoundedInteger(
  value: string | number | null | undefined,
  { fallback, min, max, outOfRange = 'clamp' }: BoundedIntegerOptions,
): number {
  const normalized = typeof value === 'string' ? value.trim() : value;
  if (normalized === '' || normalized === null || normalized === undefined) return fallback;
  if (typeof normalized === 'string' && !/^-?\d+$/.test(normalized)) return fallback;

  const parsed = typeof normalized === 'number' ? normalized : Number(normalized);
  if (!Number.isSafeInteger(parsed)) return fallback;

  if (outOfRange === 'fallback' && (parsed < min || parsed > max)) return fallback;

  return Math.min(max, Math.max(min, parsed));
}
