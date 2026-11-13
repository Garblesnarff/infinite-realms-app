/**
 * #1187: Action Surge is one Fighter feature. The second use at fighter level 17
 * is a uses count (`actionSurgeUsesAt`), not a second feature row.
 */

export function isActionSurgeName(featureName: string): boolean {
  return (
    featureName
      .replace(/\s*\([^)]*\)\s*$/, '')
      .trim()
      .toLowerCase() === 'action surge'
  );
}

export function actionSurgeRowLevel(row: { level?: number; levelAcquired?: number }): number {
  return row.levelAcquired ?? row.level ?? 0;
}

/** A level-17 "two uses" row. The feature itself is gained at level 2. */
export function isExtraActionSurgeRow(row: {
  featureName: string;
  level?: number;
  levelAcquired?: number;
}): boolean {
  return isActionSurgeName(row.featureName) && actionSurgeRowLevel(row) > 2;
}

/**
 * Keep the earliest Action Surge row (then the shorter name). Later rows are
 * the same feature. Does not remove the caller's stored rows.
 */
export function collapseActionSurgeRows<
  T extends { featureName: string; level?: number; levelAcquired?: number },
>(rows: T[]): T[] {
  const surges = rows.filter((row) => isActionSurgeName(row.featureName));
  if (surges.length <= 1) return rows;
  const keep = [...surges].sort(
    (a, b) =>
      actionSurgeRowLevel(a) - actionSurgeRowLevel(b) ||
      a.featureName.length - b.featureName.length,
  )[0];
  const drop = new Set(surges.filter((row) => row !== keep));
  return rows.filter((row) => !drop.has(row));
}
