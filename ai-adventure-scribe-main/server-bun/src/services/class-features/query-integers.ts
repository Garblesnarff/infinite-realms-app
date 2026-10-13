import { parseBoundedIntegerCore } from '../../../../shared/bounded-integer.js';

export function parseOptionalBoundedInteger(
  value: string | undefined,
  minimum: number,
  maximum: number,
): number | undefined | null {
  if (value === undefined) return undefined;

  return parseBoundedIntegerCore(value, {
    min: minimum,
    max: maximum,
    allowSigned: false,
    allowNumbers: false,
    trim: false,
    outOfRange: 'reject',
    invalidFallback: null,
    outOfRangeFallback: null,
  });
}
