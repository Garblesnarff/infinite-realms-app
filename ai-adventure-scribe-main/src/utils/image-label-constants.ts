/**
 * Common words to skip when extracting keywords for scene images.
 */
export const STOP_WORDS = new Set([
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

/**
 * UUID and technical identifier patterns to filter out.
 */
export const UUID_SEGMENT_PATTERN = /^[a-f0-9]{4,8}$/i; // Matches hex strings 4-8 chars (UUID segments)
export const HEX_STRING_PATTERN = /^[a-f0-9]{6,}$/i; // Matches longer hex strings
export const TECHNICAL_PREFIX_PATTERN = /^(id|uuid|ref|msg|session|combat)[-_]/i; // Matches technical prefixes
export const HIGH_DIGIT_RATIO_PATTERN = /\d.*\d.*\d/; // Matches words with 3+ digits

/**
 * Fantasy/RPG terms to prioritize (score +3).
 */
export const FANTASY_TERMS = new Set([
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

/**
 * Location/setting terms to prioritize (score +2).
 */
export const LOCATION_TERMS = new Set([
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

/**
 * Generic verbs to deprioritize (score -1).
 */
export const GENERIC_VERBS = new Set([
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
