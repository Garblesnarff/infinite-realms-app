/**
 * Detects whether a DM message already has clickable action options.
 *
 * The DM response schema normally supplies lettered options (A. **Action**, description)
 * that the UI renders as buttons (see parseMessageOptions / DynamicOptionsSection). When
 * a response has none, this module leaves the free-text alone — a generic menu is worse
 * than an empty one because it pretends the scene offered choices it did not.
 */
import logger from '@/lib/logger';
import { parseMessageOptions } from '@/utils/parseMessageOptions';

export function messageHasOptions(text: string): boolean {
  try {
    return parseMessageOptions(text).hasOptions;
  } catch {
    return false;
  }
}

/**
 * Returns `text` unchanged. Options stay if the model wrote them; otherwise the player
 * has free-text only. Callers keep this hook so a future scene-grounded repair can land
 * in one place without rewiring the response pipeline.
 */
export async function ensureActionOptions(text: string): Promise<string> {
  if (!text || messageHasOptions(text)) return text;
  logger.warn('[EnsureOptions] DM response had no action options; leaving free-text only');
  return text;
}
