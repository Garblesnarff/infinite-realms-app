/**
 * #1344: the server refuses a custom or imported hero from a free plan with
 * 403 `code: 'LEGEND_REQUIRED'`. A thrown error carries that code either on
 * `code` (the JSON import path) or on `payload.code` (the user-data API path).
 */
export function isLegendRequiredError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, payload } = error as { code?: unknown; payload?: { code?: unknown } };
  return code === 'LEGEND_REQUIRED' || payload?.code === 'LEGEND_REQUIRED';
}
