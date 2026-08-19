import { calculateImportance } from '@/utils/memory/importance';

/**
 * Scores how much a memory matters before it is written.
 *
 * This class used to generate the memory's embedding too, behind
 * `isSemanticMemoriesEnabled()`. That flag was off in production for the whole life of the
 * memories table, so `evaluate()` returned `{ embedding: null }` for all 4530 rows ever
 * written (#1822). Embedding now happens server-side after the row is inserted
 * (server-bun MemoryService.insert -> attachEmbedding), which is the only place that can
 * guarantee it happens at all. The browser scores importance and nothing else.
 */
export class MemoryImportanceService {
  public evaluate(content: string, type: string, category: string): { importance: number } {
    return { importance: calculateImportance({ content, type, category }) };
  }
}
