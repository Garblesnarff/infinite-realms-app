import type { ClassificationPattern } from './types';

/**
 * Enhanced patterns for character moment classification
 */
export const characterMomentPatterns: ClassificationPattern = {
  type: 'character_moment',
  patterns: [
    // Character development
    'growth',
    'change',
    'development',
    'evolution',
    'transformation',
    // Emotional moments
    'realization',
    'epiphany',
    'breakthrough',
    'awakening',
    // Character interactions
    'bonding',
    'conflict',
    'reconciliation',
    'betrayal',
    // Personal moments
    'decision',
    'choice',
    'sacrifice',
    'courage',
    'fear',
  ],
  contextPatterns: [
    // Matches character growth
    /(?:character|player) (?:grows|learns|realizes|understands)/i,
    // Matches emotional moments
    /(?:feels|experiences|realizes|discovers) (?:fear|courage|love|anger)/i,
    // Matches defining moments
    /(?:defining|pivotal|life-changing) (?:moment|decision|choice)/i,
  ],
  importance: 6,
};
