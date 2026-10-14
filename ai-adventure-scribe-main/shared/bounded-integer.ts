interface BoundedIntegerCoreBaseOptions<TInvalid> {
  min: number;
  max: number;
  allowSigned?: boolean;
  allowNumbers?: boolean;
  trim?: boolean;
  invalidFallback: TInvalid;
}

/**
 * `reject` must name the value returned for an out-of-range input. Without the
 * field the call does not type-check, so the parser cannot return an undefined
 * value typed as TOutOfRange.
 */
export type BoundedIntegerCoreOptions<TInvalid, TOutOfRange = number> =
  | (BoundedIntegerCoreBaseOptions<TInvalid> & {
      outOfRange?: 'clamp';
      outOfRangeFallback?: never;
    })
  | (BoundedIntegerCoreBaseOptions<TInvalid> & {
      outOfRange: 'reject';
      outOfRangeFallback: TOutOfRange;
    });

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
    invalidFallback,
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
    if (options.outOfRange === 'reject') {
      return options.outOfRangeFallback;
    }
    return Math.min(max, Math.max(min, num));
  }

  return num;
}
