import type { ClassificationPattern } from './types';

/**
 * Enhanced patterns for quest classification
 */
export const questPatterns: ClassificationPattern = {
  type: 'quest',
  patterns: [
    // Quest keywords
    'quest',
    'mission',
    'task',
    'assignment',
    'objective',
    // Quest types
    'journey',
    'expedition',
    'adventure',
    'trial',
    'test',
    // Quest elements
    'retrieve',
    'deliver',
    'rescue',
    'defeat',
    'find',
    // Quest rewards
    'reward',
    'treasure',
    'blessing',
    'boon',
    'payment',
  ],
  contextPatterns: [
    // Matches quest beginnings
    /(?:begin|start|embark|undertake) (?:quest|mission|journey)/i,
    // Matches quest objectives
    /(?:must|need to|have to) (?:find|retrieve|deliver|defeat|rescue)/i,
    // Matches quest completion
    /(?:complete|finish|accomplish|succeed) (?:quest|mission|task)/i,
  ],
  importance: 8,
};
