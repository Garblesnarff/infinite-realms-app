/**
 * Level shown on a starter-campaign card and its detail page.
 *
 * The stored `level_range` is the campaign bible's start-to-finish span, and
 * the span is the level range the campaign is played at: a level-3 one-shot's
 * pregens are level 3, so its card reads "Level 3", not "Level 1" (#829).
 * A hyphenated finish ("Finish 10–11") was ingested as a third number, which
 * is how Abyssal Descent's span arrived as "7-10-11"; the played range is the
 * first and last numbers. A span whose start and finish agree shows the
 * single level.
 */
export function formatStarterLevelRange(levelRange: string | null | undefined): string | null {
  if (!levelRange?.trim()) return null;

  const parts = levelRange
    .split('-')
    .map((part) => part.trim())
    .filter(Boolean);
  const start = Number(parts[0]);
  if (!Number.isFinite(start)) return '1';
  if (parts.length === 1) return parts[0];

  const end = parts[parts.length - 1];
  return end === parts[0] ? parts[0] : `${parts[0]}-${end}`;
}
