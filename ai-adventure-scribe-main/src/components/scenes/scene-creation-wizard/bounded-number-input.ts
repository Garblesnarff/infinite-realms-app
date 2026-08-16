export function readBoundedInteger(value: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return minimum;

  return Math.max(minimum, Math.min(Math.trunc(parsed), maximum));
}
