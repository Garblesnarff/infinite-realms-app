import type { ClassificationPattern } from './types';

/**
 * Enhanced patterns for story beat classification
 */
export const storyBeatPatterns: ClassificationPattern = {
  type: 'story_beat',
  patterns: [
    // Story structure
    'beat',
    'moment',
    'scene',
    'sequence',
    'chapter',
    // Dramatic moments
    'climax',
    'turning point',
    'revelation',
    'confrontation',
    // Pacing elements
    'tension',
    'suspense',
    'buildup',
    'payoff',
    'resolution',
    // Story beats
    'inciting incident',
    'call to action',
    'point of no return',
  ],
  contextPatterns: [
    // Matches dramatic moments
    /(?:dramatic|pivotal|crucial|defining) (?:moment|scene|confrontation)/i,
    // Matches story progression
    /(?:story|narrative) (?:builds|escalates|reaches|climaxes)/i,
    // Matches beat descriptions
    /(?:key|important|significant) (?:beat|moment|development)/i,
  ],
  importance: 7,
};
