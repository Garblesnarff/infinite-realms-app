import type { ClassificationPattern } from './types';

/**
 * Enhanced patterns for atmosphere classification
 */
export const atmospherePatterns: ClassificationPattern = {
  type: 'atmosphere',
  patterns: [
    // Mood and tone
    'atmosphere',
    'mood',
    'tone',
    'feeling',
    'ambiance',
    // Emotional atmosphere
    'tension',
    'suspense',
    'dread',
    'wonder',
    'mystery',
    // Environmental atmosphere
    'eeriness',
    'serenity',
    'chaos',
    'peace',
    'danger',
    // Sensory elements
    'sight',
    'sound',
    'smell',
    'touch',
    'taste',
  ],
  contextPatterns: [
    // Matches atmospheric descriptions
    /(?:air|atmosphere) (?:thick with|heavy with|filled with)/i,
    // Matches mood settings
    /(?:tense|peaceful|mysterious|ominous) (?:atmosphere|mood|feeling)/i,
    // Matches sensory atmosphere
    /(?:sounds|smells|feels) (?:of|like) (?:\w+)/i,
  ],
  importance: 4,
};
