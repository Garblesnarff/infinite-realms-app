import { approximateTokens } from './token-budget';

/**
 * Flat, numbers-only token-count breakdown of a DM prompt, keyed by section
 * name plus a `total`. Intentionally contains ONLY counts -- never prompt
 * content -- so it is safe to log and to send to the server.
 */
export type PromptMetrics = Record<string, number>;

/**
 * Estimate per-section token counts for a DM prompt, using the same
 * character-based estimator (`approximateTokens`) the history budget already
 * relies on.
 *
 * Pure and defensive:
 * - Missing/null/undefined/empty section values count as 0.
 * - Non-string values (which should never happen at the type level, but can
 *   at runtime if a caller is loose with types) also count as 0 rather than
 *   throwing.
 * - `total` is the sum of every section's count.
 * - This function is guaranteed to never throw -- per-section estimation
 *   failures degrade that section to 0 instead of propagating.
 */
export function measurePromptSections(
  sections: Record<string, string | null | undefined>,
): PromptMetrics {
  const metrics: PromptMetrics = {};
  let total = 0;

  for (const [name, value] of Object.entries(sections || {})) {
    let count = 0;
    try {
      if (typeof value === 'string' && value.length > 0) {
        count = approximateTokens(value);
      }
    } catch {
      count = 0;
    }
    metrics[name] = count;
    total += count;
  }

  metrics.total = total;
  return metrics;
}
