/**
 * MemoryLoader
 *
 * Loads recent memories for a session from Supabase.
 *
 * Dependencies:
 * - Supabase client (src/integrations/supabase/client.ts)
 * - Memory type (src/types/memory.ts)
 *
 * @author AI Dungeon Master Team
 */

import { userDataApi } from '@/services/user-data-api';
import { isValidMemoryType } from '@/types/memory';
import type { Memory } from '@/types/memory';
import { logger } from '../../../lib/logger';

export class MemoryLoader {
  /**
   * Loads recent memories for a session.
   *
   * @param {string} sessionId - The session ID
   * @param {number} limit - Number of recent memories to fetch
   * @returns {Promise<Memory[]>} Array of recent memories
   */
  async loadRecentMemories(sessionId: string, limit = 10): Promise<Memory[]> {
    // ⚡ Bolt: Use explicit column selection to avoid over-fetching large vector embeddings (~3KB per row).
    const data = await userDataApi.listMemories(sessionId, { limit });

    return (data || []).map((memory): Memory => {
      if (!isValidMemoryType(memory.type)) {
        logger.warn(
          `[MemoryLoader] Invalid memory type detected: ${memory.type}, defaulting to 'general'`,
        );
        memory.type = 'general';
      }
      return {
        ...memory,
        type: isValidMemoryType(memory.type) ? memory.type : 'general',
      };
    });
  }
}
