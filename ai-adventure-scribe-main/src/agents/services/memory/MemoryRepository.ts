import { userDataApi } from '@/services/user-data-api';

import { type Memory } from '@/types/memory';

export class MemoryRepository {
  /**
   * Memories are written as bare content. The server embeds them after the insert commits
   * (#1822); the browser deliberately sends no vector, so there is no path left where a
   * client-side failure can quietly produce a row with a null embedding.
   */
  async insertMemories(records: Array<Record<string, any>>): Promise<void> {
    if (!records.length) return;
    await userDataApi.createMemories(records);
  }

  async loadTopMemories(sessionId: string, limit: number): Promise<Memory[]> {
    return userDataApi.listMemories(sessionId, { limit, top: true }) as Promise<Memory[]>;
  }

  /** Server embeds the query and merges similarity with top-by-importance (#2282). */
  async recallMemories(sessionId: string, query: string, limit: number): Promise<Memory[]> {
    return userDataApi.recallMemories(sessionId, query, limit) as Promise<Memory[]>;
  }

  /**
   * Similarity search over a session's memories.
   *
   * Currently uncalled: its only caller embedded the query in the browser through the edge
   * function that PR2 removed. Kept because the vector it needs is what PR3 adds — a
   * server-side query embedding — and this is the client side of that round trip. It no
   * longer checks a feature flag: with the write path fixed, whether similarity search is
   * worth running is a question about the data, not about a build-time constant.
   */
  async matchMemories(sessionId: string, embedding: string, limit: number, threshold: number) {
    return userDataApi.matchMemories(sessionId, embedding, limit, threshold);
  }
}
