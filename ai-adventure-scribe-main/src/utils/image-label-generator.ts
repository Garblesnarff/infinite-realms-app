/**
 * Utility for generating semantic, user-friendly labels for scene images.
 *
 * Instead of generic labels like "scene-uuid-abc123", this generates
 * contextual labels like "dragons-lair-tavern-innkeeper-nervous".
 */

// Common words to skip when extracting keywords
const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'for',
  'from',
  'has',
  'have',
  'in',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'that',
  'the',
  'to',
  'was',
  'were',
  'will',
  'with',
  'you',
  'your',
]);

/**
 * Sanitizes a string to be filename-safe.
 * - Removes special characters
 * - Converts to lowercase
 * - Replaces spaces with hyphens
 * - Limits length
 */
function sanitizeForFilename(text: string, maxLength: number = 20): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special chars except spaces and hyphens
    .trim()
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .slice(0, maxLength) // Limit length
    .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
}

/**
 * Extracts meaningful keywords from scene text.
 * Skips common words and returns up to maxKeywords significant terms.
 */
function extractKeywords(text: string, maxKeywords: number = 4): string[] {
  if (!text || !text.trim()) {
    return [];
  }

  // Split into words and filter
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ') // Replace punctuation with spaces
    .split(/\s+/)
    .filter((word) => {
      return (
        word.length > 2 && // Skip very short words
        !STOP_WORDS.has(word) && // Skip common words
        !/^\d+$/.test(word) // Skip pure numbers
      );
    });

  // Return first N unique keywords
  const uniqueWords = [...new Set(words)];
  return uniqueWords.slice(0, maxKeywords);
}

/**
 * Generates a semantic, user-friendly label for a scene image.
 *
 * @param campaignName - The name of the campaign (will be sanitized and truncated)
 * @param sceneText - The scene description text to extract keywords from
 * @param options - Optional configuration
 * @returns A filename-safe label like "dragons-lair-tavern-innkeeper"
 *
 * @example
 * ```typescript
 * generateImageLabel(
 *   "The Dragon's Lair",
 *   "You enter the dimly lit tavern. The innkeeper looks up nervously."
 * )
 * // Returns: "dragons-lair-tavern-innkeeper-nervous"
 * ```
 */
export function generateImageLabel(
  campaignName: string | null | undefined,
  sceneText: string | null | undefined,
  options?: {
    maxCampaignLength?: number;
    maxKeywords?: number;
    fallbackLabel?: string;
  },
): string {
  const maxCampaignLength = options?.maxCampaignLength ?? 20;
  const maxKeywords = options?.maxKeywords ?? 3;
  const fallbackLabel = options?.fallbackLabel ?? 'scene';

  const parts: string[] = [];

  // Add sanitized campaign name if available
  if (campaignName && campaignName.trim()) {
    const sanitizedCampaign = sanitizeForFilename(campaignName, maxCampaignLength);
    if (sanitizedCampaign) {
      parts.push(sanitizedCampaign);
    }
  }

  // Extract and add keywords from scene text
  if (sceneText && sceneText.trim()) {
    const keywords = extractKeywords(sceneText, maxKeywords);
    parts.push(...keywords);
  }

  // If we have no parts, use fallback
  if (parts.length === 0) {
    return fallbackLabel;
  }

  // Join parts with hyphens and ensure filename safety
  return parts.join('-');
}

/**
 * Formats a label for display (capitalizes words, replaces hyphens with spaces).
 * This is the inverse of the filename sanitization.
 *
 * @param label - The filename-safe label
 * @returns A human-readable label like "Dragons Lair Tavern Innkeeper"
 *
 * @example
 * ```typescript
 * formatLabelForDisplay("dragons-lair-tavern-innkeeper")
 * // Returns: "Dragons Lair Tavern Innkeeper"
 * ```
 */
export function formatLabelForDisplay(label: string): string {
  if (!label || !label.trim()) {
    return '';
  }

  return label
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
