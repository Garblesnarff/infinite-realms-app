import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';
import { isSemanticMemoriesEnabled } from '@/config/featureFlags';

import { type Memory } from '@/types/memory';

let hasLoggedSemanticDisabled = false;

export class MemoryRepository {
  async insertMemories(records: Array<Record<string, any>>): Promise<void> {
    if (!records.length) return;
    await userDataApi.createMemories(records);
  }

  async loadTopMemories(sessionId: string, limit: number): Promise<Memory[]> {
    return userDataApi.listMemories(sessionId, { limit, top: true }) as Promise<Memory[]>;
  }

  async matchMemories(sessionId: string, embedding: string, limit: number, threshold: number) {
    if (!isSemanticMemoriesEnabled()) {
      if (!hasLoggedSemanticDisabled) {
        logger.debug('[MemoryRepository] Semantic memories disabled; skipping semantic match.');
        hasLoggedSemanticDisabled = true;
      }
      return [];
    }
    return userDataApi.matchMemories(sessionId, embedding, limit, threshold);
  }

  async invokeEmbedding(text: string): Promise<string | null> {
    if (!isSemanticMemoriesEnabled()) {
      if (!hasLoggedSemanticDisabled) {
        logger.debug(
          '[MemoryRepository] Semantic memories disabled; skipping embedding generation.',
        );
        hasLoggedSemanticDisabled = true;
      }
      return null;
    }
    const { data, error } = await supabase.functions.invoke<{ embedding: string }>(
      'generate-embedding',
      {
        body: { text },
      },
    );
    if (error) return null;
    return data?.embedding ?? null;
  }
}
