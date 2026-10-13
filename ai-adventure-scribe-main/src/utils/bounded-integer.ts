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
  return parseBoundedIntegerCore(value, {
    min,
    max,
    allowSigned: true,
    allowNumbers: true,
    trim: true,
    outOfRange: outOfRange === 'fallback' ? 'reject' : 'clamp',
    invalidFallback: fallback,
    outOfRangeFallback: fallback,
  });
}
