export interface BoundedIntegerCoreOptions<TInvalid, TOutOfRange = number> {
  min: number;
  max: number;
  allowSigned?: boolean;
  allowNumbers?: boolean;
  trim?: boolean;
  outOfRange?: 'clamp' | 'reject';
  invalidFallback: TInvalid;
  outOfRangeFallback?: TOutOfRange;
}

/**
 * Shared core numeric parser for bounded integer utilities.
 */
export function parseBoundedIntegerCore<TInvalid, TOutOfRange = number>(
  value: unknown,
  options: BoundedIntegerCoreOptions<TInvalid, TOutOfRange>,
): number | TInvalid | TOutOfRange {
  const {
    min,
    max,
    allowSigned = false,
    allowNumbers = false,
    trim = false,
    outOfRange = 'clamp',
    invalidFallback,
    outOfRangeFallback,
  } = options;

  let raw: unknown = value;
  if (typeof raw === 'string' && trim) {
    raw = raw.trim();
  }

  if (raw === '' || raw === null || raw === undefined) {
    return invalidFallback;
  }

  let num: number;
  if (typeof raw === 'number') {
    if (!allowNumbers) {
      return invalidFallback;
    }
    num = raw;
  } else if (typeof raw === 'string') {
    const pattern = allowSigned ? /^-?\d+$/ : /^\d+$/;
    if (!pattern.test(raw)) {
      return invalidFallback;
    }
    num = Number(raw);
  } else {
    return invalidFallback;
  }

  if (!Number.isSafeInteger(num)) {
    return invalidFallback;
  }

  if (num < min || num > max) {
    if (outOfRange === 'reject') {
      return outOfRangeFallback as TOutOfRange;
    }
    return Math.min(max, Math.max(min, num));
  }

  return num;
}
