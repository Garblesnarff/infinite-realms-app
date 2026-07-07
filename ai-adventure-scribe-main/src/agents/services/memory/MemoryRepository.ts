import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';
import { isSemanticMemoriesEnabled } from '@/config/featureFlags';

import type { EnhancedMemory, MemoryQueryOptions } from '@/types/memory';
import { type Memory } from '@/types/memory';

let hasLoggedSemanticDisabled = false;

export class MemoryRepository {
  async insertMemories(records: Array<Record<string, any>>): Promise<void> {
    if (!records.length) return;
    await userDataApi.createMemories(records);
  }

  async loadRecentMemories(sessionId: string, limit: number = 5): Promise<Memory[]> {
    return userDataApi.listMemories(sessionId, { limit }) as Promise<Memory[]>;
  }

  async loadTopMemories(sessionId: string, limit: number): Promise<Memory[]> {
    return userDataApi.listMemories(sessionId, { limit, top: true }) as Promise<Memory[]>;
  }

  async loadFictionReadyMemories(sessionId: string, minNarrativeWeight: number): Promise<Memory[]> {
    return userDataApi.listMemories(sessionId, { minNarrativeWeight }) as Promise<Memory[]>;
  }

  async fetchMemories(sessionId: string, options: MemoryQueryOptions = {}): Promise<any[]> {
    return userDataApi.listMemories(sessionId, {
      category: options.category,
      recentMinutes: options.timeframe === 'recent' ? 30 : undefined,
      limit: options.limit,
    });
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

  async updateMemoryScores(
    memoryId: string,
    updates: { importance?: number; narrative_weight?: number },
  ): Promise<void> {
    await userDataApi.updateMemoryScores(memoryId, updates);
  }

  async insertCommunication(payload: any): Promise<void> {
    const { error } = await supabase.from('agent_communications').insert(payload);
    if (error) throw error;
  }

  async fetchMemoryById(
    memoryId: string,
  ): Promise<{ importance?: number; narrative_weight?: number } | null> {
    try {
      const data = await userDataApi.getMemory(memoryId);
      return data as { importance?: number; narrative_weight?: number };
    } catch {
      return null;
    }
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

  transformDatabaseMemory(dbMemory: any): EnhancedMemory {
    const metadata = dbMemory.metadata || {};
    const context = metadata.context ? JSON.parse(metadata.context) : {};
    return {
      id: dbMemory.id,
      type: dbMemory.type,
      content: dbMemory.content,
      timestamp: dbMemory.created_at,
      importance: dbMemory.importance || 0,
      category: metadata.category || 'general',
      context,
      metadata: dbMemory.metadata || {},
    };
  }
}
