import { calculateImportance } from './importance';
import { CLASSIFICATION_PATTERNS } from './patterns';
import { splitIntoSegments, sanitizeForMemoryExtraction } from './segmentation';

import type { MemoryType } from '@/types/memory';

/**
 * Interface for classified memory segment
 */
interface MemorySegment {
  content: string;
  type: MemoryType;
  importance: number;
}

/**
 * Determines the most appropriate type for a memory segment
 */
export const classifySegment = (content: string): MemoryType => {
  const scores = new Map<MemoryType, number>();
  const lowerContent = content.toLowerCase();

  // Initialize scores
  Object.keys(CLASSIFICATION_PATTERNS).forEach((type) => {
    scores.set(type as MemoryType, 0);
  });

  // Calculate scores for each type
  Object.entries(CLASSIFICATION_PATTERNS).forEach(([type, { patterns, contextPatterns }]) => {
    // Check for exact pattern matches
    patterns.forEach((pattern) => {
      const regex = new RegExp(`\\b${pattern}\\b`, 'i');
      if (regex.test(lowerContent)) {
        const currentScore = scores.get(type as MemoryType) || 0;
        scores.set(type as MemoryType, currentScore + 1);
      }
    });

    // Check for context pattern matches
    contextPatterns.forEach((pattern) => {
      if (pattern.test(content)) {
        const currentScore = scores.get(type as MemoryType) || 0;
        scores.set(type as MemoryType, currentScore + 2);
      }
    });
  });

  // Find type with highest score
  let maxScore = 0;
  let bestType: MemoryType = 'general';

  scores.forEach((score, type) => {
    if (score > maxScore) {
      maxScore = score;
      bestType = type;
    }
  });

  return maxScore > 0 ? bestType : 'general';
};

/**
 * Processes content into classified memory segments
 */
export const processContent = (content: string): MemorySegment[] => {
  if (!content || content.trim().length === 0) return [];

  const segments = splitIntoSegments(content, {
    maxLength: 100,
    minLength: 20,
    preserveQuotes: true,
  });

  // Fallback: if nothing met minLength, use sanitized content as a single segment
  const effectiveSegments =
    segments.length === 0 ? [sanitizeForMemoryExtraction(content)] : segments;

  const mapToImportanceType = (type: MemoryType): string => {
    switch (type) {
      case 'npc':
      case 'character_moment':
        return 'character';
      case 'story_beat':
      case 'plot_point':
      case 'foreshadowing':
        return 'plot';
      case 'dialogue_gem':
        return 'dialogue';
      case 'world_detail':
      case 'atmosphere':
      case 'quest': // Quests can also be considered events for importance calculation
        return 'event';
      default:
        return type;
    }
  };

  return effectiveSegments.map((segment) => {
    const type = classifySegment(segment);
    const importance = calculateImportance({
      content: segment,
      type: mapToImportanceType(type),
    });
    const baseImportance = CLASSIFICATION_PATTERNS[type]?.importance ?? 3;

    // Stored as is: memories.importance is on the same 1-10 scale as calculateImportance (#2283).
    return {
      content: segment.trim(),
      type,
      importance: Math.max(importance, baseImportance),
    };
  });
};
