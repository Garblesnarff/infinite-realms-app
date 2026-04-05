import type { ClassificationPattern } from './types';

/**
 * Enhanced patterns for item classification
 */
export const itemPatterns: ClassificationPattern = {
  type: 'item',
  patterns: [
    // Weapons
    'sword',
    'blade',
    'axe',
    'bow',
    'shield',
    // Magic items
    'scroll',
    'potion',
    'ring',
    'amulet',
    'staff',
    // Quest items
    'artifact',
    'relic',
    'key',
    'map',
    'crystal',
    // Common items
    'book',
    'tome',
    'letter',
    'coin',
    'gem',
  ],
  contextPatterns: [
    // Matches magical items
    /(?:enchanted|magical|cursed|blessed|ancient) (?:sword|staff|ring|amulet)/i,
    // Matches important items
    /(?:legendary|mythical|powerful|sacred) (?:artifact|weapon|relic)/i,
  ],
  importance: 5,
};
