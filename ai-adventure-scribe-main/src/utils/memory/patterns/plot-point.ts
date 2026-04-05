import type { ClassificationPattern } from './types';

/**
 * Enhanced patterns for plot point classification
 */
export const plotPointPatterns: ClassificationPattern = {
  type: 'plot_point',
  patterns: [
    // Plot structure
    'plot point',
    'development',
    'twist',
    'reveal',
    'discovery',
    // Story progression
    'advancement',
    'progression',
    'escalation',
    'complication',
    // Plot elements
    'conflict',
    'resolution',
    'obstacle',
    'solution',
    'breakthrough',
    // Narrative beats
    'setup',
    'payoff',
    'callback',
    'foreshadowing',
    'culmination',
  ],
  contextPatterns: [
    // Matches plot developments
    /(?:plot|story) (?:thickens|develops|advances|progresses)/i,
    // Matches significant developments
    /(?:major|significant|crucial) (?:development|revelation|discovery)/i,
    // Matches plot points
    /(?:first|second|third) (?:act|plot point)/i,
  ],
  importance: 8,
};
