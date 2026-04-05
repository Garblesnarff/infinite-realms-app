import type { ClassificationPattern } from './types';

/**
 * Enhanced patterns for NPC classification
 */
export const npcPatterns: ClassificationPattern = {
  type: 'npc',
  patterns: [
    // Named NPCs and specific individuals
    'npc',
    'character',
    'person',
    'individual',
    'figure',
    // Common fantasy titles
    'king',
    'queen',
    'lord',
    'lady',
    // Roles and titles
    'elder',
    'chief',
    'leader',
    'merchant',
    'guard',
    'innkeeper',
    // Fantasy beings
    'wizard',
    'sage',
    'oracle',
    'spirit',
    'demon',
    'dragon',
    // Character descriptors
    'warrior',
    'mage',
    'priest',
    'hero',
    'villain',
    'stranger',
  ],
  contextPatterns: [
    // Matches "the X" where X is likely a character title
    /the\s+(?:\w+\s+)?(?:elder|chief|king|queen|lord|lady|wizard|innkeeper|merchant)/i,
    // Matches character descriptions
    /(?:wise|old|young|mysterious|brave|dark) (?:wizard|warrior|sage|master|stranger)/i,
    // Matches character names with titles
    /[A-Z][a-z]+ the (?:Elder|Wise|Bold|Great)/i,
  ],
  importance: 6,
};
