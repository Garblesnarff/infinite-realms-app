interface BoundedQueryIntegerOptions {
  min: number;
  max: number;
}

/** Parse a complete decimal query value and clamp it to an explicit safe range. */
export function parseBoundedQueryInteger(
  value: unknown,
  { min, max }: BoundedQueryIntegerOptions,
): number | undefined {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return undefined;

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return undefined;

  return Math.min(max, Math.max(min, parsed));
}
