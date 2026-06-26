/**
 * Voice Utilities
 *
 * Shared utility functions for voice processing, name normalization,
 * and text cleaning.
 *
 * @author AI Dungeon Master Team
 */

/**
 * Normalize character names for consistency across the voice system
 */
export function normalizeCharacterName(name: string): string {
  if (!name) return '';

  return name
    .trim()
    .toLowerCase()
    .replace(/^(the|a|an)\s+/i, '') // Remove articles
    .replace(/[^\w\s'-]/g, '') // Keep only letters, spaces, apostrophes, hyphens
    .replace(/\s+/g, ' ') // Normalize spaces
    .trim();
}

/**
 * Infer voice category from character name when AI doesn't provide one
 */
export function inferVoiceCategory(characterName: string): string {
  const name = characterName.toLowerCase();

  // Check for character type keywords
  const keywords = {
    elder: ['wizard', 'sage', 'old', 'ancient', 'elder', 'master', 'thorne'],
    villain_male: ['villain', 'dark', 'evil', 'lord', 'demon', 'shadow'],
    villain_female: ['witch', 'sorceress', 'dark lady', 'empress'],
    guard: ['guard', 'soldier', 'captain', 'knight', 'watchman'],
    merchant: ['merchant', 'trader', 'shopkeeper', 'vendor'],
    child: ['child', 'kid', 'young', 'boy', 'girl'],
    monster: ['dragon', 'beast', 'creature', 'monster', 'giant'],
    goblin: ['goblin', 'imp', 'sprite', 'kobold'],
  };

  for (const [category, keywordList] of Object.entries(keywords)) {
    if (keywordList.some((keyword) => name.includes(keyword))) {
      return category;
    }
  }

  // Default fallbacks
  if (name.includes('female') || name.includes('woman') || name.includes('lady')) {
    return 'hero_female';
  }

  // Default to male hero voice
  return 'hero_male';
}

/**
 * Clean segment text for audio generation by removing markdown and normalizing spaces
 */
export function cleanSegmentText(text: string): string {
  if (!text) return '';

  return text
    .replace(/[*_`#]/g, '') // Remove markdown
    .replace(/\s+/g, ' ') // Normalize spaces
    .trim();
}
