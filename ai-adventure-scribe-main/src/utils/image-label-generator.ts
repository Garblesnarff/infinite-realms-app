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
  // Meta-narrative terms
  'scene',
  'turn',
  'round',
  'roll',
  'message',
  'generated',
  // Generic verbs
  'enter',
  'walk',
  'look',
  'see',
  'hear',
  'goes',
  'gets',
  'takes',
  'enters',
  'walks',
  'looks',
  'sees',
  'hears',
  // Pronouns
  'yours',
]);

// UUID and technical identifier patterns to filter out
const UUID_SEGMENT_PATTERN = /^[a-f0-9]{4,8}$/i; // Matches hex strings 4-8 chars (UUID segments)
const HEX_STRING_PATTERN = /^[a-f0-9]{6,}$/i; // Matches longer hex strings
const TECHNICAL_PREFIX_PATTERN = /^(id|uuid|ref|msg|session|combat)[-_]/i; // Matches technical prefixes
const HIGH_DIGIT_RATIO_PATTERN = /\d.*\d.*\d/; // Matches words with 3+ digits

// Fantasy/RPG terms to prioritize (score +3)
const FANTASY_TERMS = new Set([
  'dragon',
  'dragons',
  'dungeon',
  'dungeons',
  'castle',
  'wizard',
  'magic',
  'spell',
  'sword',
  'knight',
  'goblin',
  'goblins',
  'orc',
  'orcs',
  'elf',
  'elves',
  'dwarf',
  'dwarves',
  'treasure',
  'quest',
  'adventure',
  'monster',
  'monsters',
  'demon',
  'demons',
  'undead',
  'vampire',
  'werewolf',
  'necromancer',
  'paladin',
  'rogue',
  'warrior',
  'sorcerer',
  'artifact',
  'enchanted',
  'cursed',
  'ancient',
  'legendary',
]);

// Location/setting terms to prioritize (score +2)
const LOCATION_TERMS = new Set([
  'tavern',
  'inn',
  'temple',
  'ruins',
  'village',
  'town',
  'city',
  'forest',
  'mountain',
  'mountains',
  'cave',
  'cavern',
  'tower',
  'fortress',
  'keep',
  'gate',
  'bridge',
  'river',
  'lake',
  'sea',
  'ocean',
  'shore',
  'cliff',
  'valley',
  'road',
  'path',
  'trail',
  'chamber',
  'hall',
  'throne',
  'library',
  'cellar',
  'crypt',
]);

// Generic verbs to deprioritize (score -1)
const GENERIC_VERBS = new Set([
  'make',
  'makes',
  'made',
  'take',
  'taking',
  'get',
  'getting',
  'got',
  'give',
  'giving',
  'gave',
  'put',
  'putting',
  'come',
  'coming',
  'came',
  'go',
  'going',
  'went',
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
 * Checks if a word is a technical identifier that should be filtered out.
 * Filters UUID segments, hex strings, technical prefixes, and high-digit-ratio words.
 */
function isTechnicalIdentifier(word: string): boolean {
  return (
    UUID_SEGMENT_PATTERN.test(word) ||
    HEX_STRING_PATTERN.test(word) ||
    TECHNICAL_PREFIX_PATTERN.test(word) ||
    HIGH_DIGIT_RATIO_PATTERN.test(word)
  );
}

/**
 * Scores a keyword based on its semantic value for image labeling.
 * Higher scores indicate more meaningful/specific terms.
 *
 * @param word - The keyword to score
 * @param context - Optional context for genre-aware scoring
 * @returns Score (higher is better, can be negative)
 */
function scoreKeyword(word: string, context?: { genre?: string }): number {
  let score = 0;

  // +3 for fantasy/RPG terms (dragon, wizard, etc.)
  if (FANTASY_TERMS.has(word)) {
    score += 3;
  }

  // +2 for location/setting terms (tavern, forest, etc.)
  if (LOCATION_TERMS.has(word)) {
    score += 2;
  }

  // +2 for longer words (usually more specific)
  if (word.length >= 6) {
    score += 2;
  }

  // +1 for medium-length words
  if (word.length >= 4 && word.length < 6) {
    score += 1;
  }

  // -1 for generic verbs
  if (GENERIC_VERBS.has(word)) {
    score -= 1;
  }

  return score;
}

/**
 * Extracts meaningful keywords from scene text with intelligent filtering and scoring.
 * Filters out UUIDs, hex strings, technical identifiers, and prioritizes fantasy/location terms.
 *
 * @param text - The text to extract keywords from
 * @param maxKeywords - Maximum number of keywords to return
 * @param context - Optional context for genre-aware scoring
 * @returns Array of scored and filtered keywords
 */
function extractKeywords(
  text: string,
  maxKeywords: number = 4,
  context?: { genre?: string },
): string[] {
  if (!text || !text.trim()) {
    return [];
  }

  // Split into words and apply initial filtering
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ') // Replace punctuation with spaces
    .split(/\s+/)
    .filter((word) => {
      return (
        word.length > 2 && // Skip very short words
        !STOP_WORDS.has(word) && // Skip common stop words
        !/^\d+$/.test(word) && // Skip pure numbers
        !isTechnicalIdentifier(word) // Skip UUIDs, hex strings, technical IDs
      );
    });

  // Remove duplicates while preserving order
  const uniqueWords = [...new Set(words)];

  // Score each word
  const scoredWords = uniqueWords.map((word) => ({
    word,
    score: scoreKeyword(word, context),
  }));

  // Sort by score (descending), then by original position for tie-breaking
  scoredWords.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    // Preserve original order for same scores
    return uniqueWords.indexOf(a.word) - uniqueWords.indexOf(b.word);
  });

  // Return top N keywords
  return scoredWords.slice(0, maxKeywords).map((item) => item.word);
}

/**
 * Generates a semantic, user-friendly label for a scene image.
 * Uses intelligent keyword extraction with UUID/hex filtering and semantic scoring.
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
 *   "You enter the dimly lit tavern. The innkeeper looks up nervously.",
 *   { genre: "fantasy" }
 * )
 * // Returns: "dragons-lair-tavern-innkeeper-nervous"
 * ```
 *
 * @example
 * ```typescript
 * // Filters out UUIDs and technical identifiers
 * generateImageLabel(
 *   "Campaign",
 *   "scene a66f6d92 4a01 4b0f in the ancient dragon temple"
 * )
 * // Returns: "campaign-ancient-dragon-temple" (UUIDs filtered out)
 * ```
 */
export function generateImageLabel(
  campaignName: string | null | undefined,
  sceneText: string | null | undefined,
  options?: {
    maxCampaignLength?: number;
    maxKeywords?: number;
    fallbackLabel?: string;
    genre?: string | null;
    characterName?: string | null;
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

  // Extract and add keywords from scene text with genre context
  if (sceneText && sceneText.trim()) {
    const keywords = extractKeywords(sceneText, maxKeywords, {
      genre: options?.genre || undefined,
    });
    parts.push(...keywords);
  }

  // If we still have no parts, try character name as fallback
  if (parts.length === 0 && options?.characterName) {
    const sanitizedCharacter = sanitizeForFilename(options.characterName, 15);
    if (sanitizedCharacter) {
      parts.push(sanitizedCharacter);
    }
  }

  // If we have no parts at all, use fallback
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
