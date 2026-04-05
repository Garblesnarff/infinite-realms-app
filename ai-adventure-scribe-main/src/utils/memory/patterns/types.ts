import type { MemoryType } from '@/types/memory';

/**
 * Interface for classification pattern
 */
export interface ClassificationPattern {
  type: MemoryType;
  patterns: string[];
  contextPatterns: RegExp[];
  importance: number;
}
