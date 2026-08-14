const MAX_TARGET_NUMBER = 100;

export function parseBoundedTargetNumber(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Math.max(
    0,
    Math.min(MAX_TARGET_NUMBER, Number.isFinite(parsed) ? parsed : MAX_TARGET_NUMBER),
  );
}
