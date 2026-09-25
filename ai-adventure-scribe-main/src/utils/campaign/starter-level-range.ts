/**
 * Level shown on a starter-campaign card and its detail page.
 *
 * The stored `level_range` is the campaign bible's start-to-finish span. A
 * hyphenated finish ("Finish 10–11") was ingested as a third number, which is
 * how Abyssal Descent's card read "Level 7-10-11". The characters a new player
 * can pick are level 1, so a span that does not start at 1 is not the level
 * they play.
 */
export function formatStarterLevelRange(levelRange: string | null | undefined): string | null {
  if (!levelRange?.trim()) return null;

  const parts = levelRange
    .split('-')
    .map((part) => part.trim())
    .filter(Boolean);
  const start = Number(parts[0]);
  if (!Number.isFinite(start) || start !== 1) return '1';
  if (parts.length === 1) return '1';

  const end = parts[parts.length - 1];
  return end === '1' ? '1' : `1-${end}`;
}
