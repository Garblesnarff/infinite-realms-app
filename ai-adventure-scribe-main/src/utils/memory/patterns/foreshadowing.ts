import type { ClassificationPattern } from './types';

/**
 * Enhanced patterns for foreshadowing classification
 */
export const foreshadowingPatterns: ClassificationPattern = {
  type: 'foreshadowing',
  patterns: [
    // Foreshadowing elements
    'foreshadowing',
    'hint',
    'clue',
    'omen',
    'portent',
    // Predictive elements
    'prophecy',
    'vision',
    'dream',
    'premonition',
    'sign',
    // Symbolic elements
    'symbol',
    'metaphor',
    'allegory',
    'parallel',
    'echo',
    // Setup elements
    'setup',
    'plant',
    'seed',
    'foundation',
    'groundwork',
  ],
  contextPatterns: [
    // Matches prophetic language
    /(?:foretells|predicts|hints at|suggests) (?:future|coming|eventual)/i,
    // Matches ominous signs
    /(?:ominous|dark|mysterious|prophetic) (?:sign|omen|portent)/i,
    // Matches symbolic elements
    /(?:symbolic|metaphoric|allegorical) (?:meaning|significance)/i,
  ],
  importance: 6,
};
