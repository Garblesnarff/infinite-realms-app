import type { ClassificationPattern } from './types';

/**
 * Enhanced patterns for event classification
 */
export const eventPatterns: ClassificationPattern = {
  type: 'event',
  patterns: [
    // Actions
    'quest',
    'journey',
    'adventure',
    'mission',
    'task',
    // Combat events
    'battle',
    'fight',
    'war',
    'conflict',
    'siege',
    // Story events
    'prophecy',
    'revelation',
    'discovery',
    'ceremony',
    // State changes
    'transformation',
    'awakening',
    'fall',
    'rise',
  ],
  contextPatterns: [
    // Matches event descriptions
    /(?:begin|start|embark|undertake) (?:quest|journey|mission)/i,
    // Matches significant moments
    /(?:ancient|great|terrible|mysterious) (?:battle|war|prophecy)/i,
  ],
  importance: 8,
};
