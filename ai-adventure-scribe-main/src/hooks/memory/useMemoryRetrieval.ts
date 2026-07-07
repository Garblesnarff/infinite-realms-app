import { useQuery } from '@tanstack/react-query';

import type { Memory } from '@/types/memory';

import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';
import { isValidMemoryType } from '@/types/memory';

export const useMemoryRetrieval = (sessionId: string | null) => {
  return useQuery({
    queryKey: ['memories', sessionId],
    queryFn: async () => {
      if (!sessionId) return [];

      logger.info('[Memory Retrieval] Fetching memories for session:', sessionId);

      // ⚡ Bolt: Using explicit column list to avoid fetching large vector embeddings (~3KB/row).
      let data;
      try {
        data = await userDataApi.listMemories(sessionId);
      } catch (error) {
        logger.error('[Memory Retrieval] Error fetching memories:', error);
        throw error;
      }

      logger.info(`[Memory Retrieval] Retrieved ${data.length} memories`);

      // Transform and validate the data to match Memory type
      return data.map((memory): Memory => {
        // Validate and ensure memory type is correct
        const validatedType = isValidMemoryType(memory.type) ? memory.type : 'general';

        if (validatedType !== memory.type) {
          logger.warn(
            `[Memory Retrieval] Invalid memory type detected: ${memory.type}, defaulting to 'general'`,
          );
        }

        return {
          id: memory.id,
          type: validatedType,
          content: memory.content,
          importance: memory.importance || 0,
          // ⚡ Bolt: Embedding is no longer fetched to improve performance.
          embedding: null,
          metadata: memory.metadata,
          created_at: memory.created_at || new Date().toISOString(),
          session_id: memory.session_id,
          updated_at: memory.updated_at || new Date().toISOString(),
        };
      });
    },
    enabled: !!sessionId,
  });
};
