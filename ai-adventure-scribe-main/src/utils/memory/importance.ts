import type { Memory } from '@/types/memory';

export { calculateImportance, type ImportanceFactors } from './importance-schedule';

/**
 * Sorts memories by importance and then by recency as a tie-breaker.
 * @param memories - Array of memories to sort.
 * @returns A new array of memories sorted by importance and recency.
 */
export const sortMemoriesByImportance = (memories: Memory[]): Memory[] => {
  return [...memories].sort((a, b) => {
    // Primary sort by importance
    const importanceDiff = (b.importance || 0) - (a.importance || 0);
    if (importanceDiff !== 0) {
      return importanceDiff;
    }
    // Secondary sort by recency (newest first)
    // ⚡ Bolt: Use direct string comparison for ISO timestamps to avoid expensive Date object creation.
    return b.created_at.localeCompare(a.created_at);
  });
};
