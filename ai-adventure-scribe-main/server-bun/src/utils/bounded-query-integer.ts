import { parseBoundedIntegerCore } from '../../../shared/bounded-integer.js';

interface BoundedQueryIntegerOptions {
  min: number;
  max: number;
}

/** Parse a complete decimal query value and clamp it to an explicit safe range. */
export function parseBoundedQueryInteger(
  value: unknown,
  { min, max }: BoundedQueryIntegerOptions,
): number | undefined {
  return parseBoundedIntegerCore(value, {
    min,
    max,
    allowSigned: false,
    allowNumbers: false,
    trim: false,
    outOfRange: 'clamp',
    invalidFallback: undefined,
  });
}
