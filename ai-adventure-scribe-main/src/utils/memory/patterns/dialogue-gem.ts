import type { ClassificationPattern } from './types';

/**
 * Enhanced patterns for dialogue gem classification
 */
export const dialogueGemPatterns: ClassificationPattern = {
  type: 'dialogue_gem',
  patterns: [
    // Memorable dialogue
    'quote',
    'saying',
    'words',
    'speech',
    'declaration',
    // Dialogue types
    'wisdom',
    'wit',
    'humor',
    'threat',
    'promise',
    // Speech acts
    'prophecy',
    'curse',
    'blessing',
    'warning',
    'advice',
    // Memorable phrases
    'catchphrase',
    'motto',
    'rallying cry',
    'final words',
  ],
  contextPatterns: [
    // Matches quoted speech
    /"[^"]*"/,
    // Matches memorable dialogue
    /(?:memorably|wisely|boldly|dramatically) (?:said|declared|proclaimed)/i,
    // Matches significant speech
    /(?:famous|legendary|prophetic|wise) (?:words|quote|saying)/i,
  ],
  importance: 5,
};
