const BACKGROUND_PATTERN = /^[a-zA-Z0-9_-]+$/;

function quotePostgrestValue(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

export function buildIlikeOrFilter(columns: readonly string[], search: string): string | null {
  const normalized = search.trim().toLowerCase();
  if (!normalized) return null;

  const pattern = quotePostgrestValue(`%${normalized}%`);
  return columns.map((column) => `${column}.ilike.${pattern}`).join(',');
}

export function buildBackgroundOrFilter(background: string): string | null {
  if (!BACKGROUND_PATTERN.test(background)) return null;
  return `background.eq.${background},background.is.null`;
}
