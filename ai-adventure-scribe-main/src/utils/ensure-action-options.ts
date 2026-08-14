/**
 * Guarantees DM messages end with clickable action options.
 *
 * The DM response schema normally supplies lettered options (A. **Action**, description)
 * that the UI renders as buttons (see parseMessageOptions / DynamicOptionsSection). This
 * module keeps a static last-resort fallback so the UI never dead-ends when a response is
 * missing that structured field.
 */
import logger from '@/lib/logger';
import { parseMessageOptions } from '@/utils/parseMessageOptions';

const STATIC_FALLBACK_OPTIONS = [
  'A. **Take in your surroundings**, study the scene for details, dangers, or opportunities.',
  'B. **Speak up**, address whoever is present and see how they respond.',
  'C. **Act on instinct**, follow your gut and make a bold move.',
].join('\n');

export function messageHasOptions(text: string): boolean {
  try {
    return parseMessageOptions(text).hasOptions;
  } catch {
    return false;
  }
}

/**
 * Returns `text` unchanged when it already contains parseable options;
 * otherwise appends static fallback options.
 */
export async function ensureActionOptions(text: string): Promise<string> {
  if (!text || messageHasOptions(text)) return text;
  logger.warn('[EnsureOptions] DM response had no action options; using static fallback');
  return `${text.trim()}\n\n${STATIC_FALLBACK_OPTIONS}`;
}
