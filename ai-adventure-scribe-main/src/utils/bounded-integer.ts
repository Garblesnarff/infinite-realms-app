import { parseBoundedIntegerCore } from '../../shared/bounded-integer.js';

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
  const shared = {
    min,
    max,
    allowSigned: true,
    allowNumbers: true,
    trim: true,
    invalidFallback: fallback,
  };
  if (outOfRange === 'fallback') {
    return parseBoundedIntegerCore(value, {
      ...shared,
      outOfRange: 'reject',
      outOfRangeFallback: fallback,
    });
  }
  return parseBoundedIntegerCore(value, { ...shared, outOfRange: 'clamp' });
}
