import type { ClassificationPattern } from './types';

/**
 * Enhanced patterns for world detail classification
 */
export const worldDetailPatterns: ClassificationPattern = {
  type: 'world_detail',
  patterns: [
    // World building
    'lore',
    'history',
    'legend',
    'myth',
    'tradition',
    // Cultural elements
    'culture',
    'custom',
    'ritual',
    'ceremony',
    'practice',
    // World systems
    'magic',
    'politics',
    'economy',
    'religion',
    'society',
    // Environmental details
    'geography',
    'climate',
    'ecology',
    'natural phenomena',
  ],
  contextPatterns: [
    // Matches world building
    /(?:ancient|legendary|mythical) (?:history|lore|tradition)/i,
    // Matches cultural details
    /(?:local|regional|cultural) (?:custom|tradition|practice)/i,
    // Matches world systems
    /(?:magic|political|religious|social) (?:system|structure|order)/i,
  ],
  importance: 5,
};
