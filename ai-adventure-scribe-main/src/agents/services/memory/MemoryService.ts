import { llmApiClient } from '@/infrastructure/api';
import { sanitizeForMemoryExtraction } from '@/utils/memory/segmentation';

import type { Memory as UIMemory, MemoryType as UIMemoryType } from '@/types/memory';

import { MemoryImportanceService } from './MemoryImportanceService';
import { MemoryRepository } from './MemoryRepository';

export type Memory = UIMemory;
export type MemoryType = UIMemoryType;

export interface MemoryExtractionResult {
  memories: Array<Omit<Memory, 'id' | 'created_at' | 'updated_at'>>;
}

export interface MemoryContext {
  sessionId: string;
  campaignId: string;
  characterId: string;
  currentLocation?: string;
  activeNPCs?: string[];
  activeQuests?: string[];
  currentMessage: string;
  recentMessages: string[];
}

const repository = new MemoryRepository();
const importanceService = new MemoryImportanceService(repository);

export class MemoryService {
  // ===== Static utilities (shared) =====
  static async generateEmbedding(content: string): Promise<string | null> {
    return importanceService.embedQuery(content);
  }

  static async saveMemories(
    memories: Array<Omit<Memory, 'id' | 'created_at' | 'updated_at'>>,
  ): Promise<void> {
    if (!memories?.length) return;
    const toInsert = await Promise.all(
      memories.map(async (m) => {
        const rawImportance = (m as unknown as Record<string, unknown>).importance;
        const type = (m as unknown as Record<string, unknown>).type ?? 'general';
        const category = (m as unknown as Record<string, unknown>).category ?? 'general';
        const evaluated = await importanceService.evaluate(
          m.content,
          String(type),
          String(category),
        );
        const importance = typeof rawImportance === 'number' ? rawImportance : evaluated.importance;
        return {
          ...m,
          importance: Math.max(1, Math.min(5, importance)),
          embedding: evaluated.embedding,
        };
      }),
    );
    await repository.insertMemories(toInsert as Array<Record<string, any>>);
  }

  static async getRelevantMemories(
    sessionId: string,
    query: string,
    limit = 10,
  ): Promise<Memory[]> {
    const queryEmbedding = await importanceService.embedQuery(query);
    if (queryEmbedding) {
      const matches = await repository.matchMemories(sessionId, queryEmbedding, limit, 0.7);
      if (matches.length) return matches as Memory[];
    }
    return repository.loadTopMemories(sessionId, limit);
  }

  /**
   * Extract memories from conversation using dedicated extraction endpoint.
   * Uses free model (DeepSeek V3.1 Nex-N1) with paid fallback (ByteDance Seed 1.6 Flash).
   * This is ~99% cheaper than using the main LLM model for extraction.
   */
  static async extractMemories(
    context: MemoryContext,
    userMessage: string,
    aiResponse: string,
  ): Promise<MemoryExtractionResult> {
    try {
      const cleanUserMessage = sanitizeForMemoryExtraction(userMessage);
      const cleanAiResponse = sanitizeForMemoryExtraction(aiResponse);

      const extractionPrompt = `You are a memory extraction system for a D&D campaign. Extract important memories from this conversation exchange.

CONTEXT:
- Session: ${context.sessionId}
- Location: ${context.currentLocation || 'Unknown'}
- Active NPCs: ${context.activeNPCs?.join(', ') || 'None'}
- Active Quests: ${context.activeQuests?.join(', ') || 'None'}

CONVERSATION:
Player: ${cleanUserMessage}
DM: ${cleanAiResponse}

Extract 1-4 key memories in this JSON format:
{
  "memories": [
    {
      "session_id": "${context.sessionId}",
      "type": "npc|location|quest|item|event|story_beat|character_moment|world_detail|dialogue_gem|atmosphere|plot_point|foreshadowing",
      "category": "brief category",
      "content": "concise memory description",
      "importance": 1-5,
      "emotional_tone": "peaceful|mysterious|foreboding|intense|triumphant|humorous|melancholy|neutral",
      "metadata": {}
    }
  ]
}`;

      // Use dedicated extraction endpoint (free model with paid fallback)
      const text = await llmApiClient.extractMemories(extractionPrompt, 1000);

      if (!text) return { memories: [] };

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return { memories: [] };

      try {
        return JSON.parse(jsonMatch[0]) as MemoryExtractionResult;
      } catch {
        return { memories: [] };
      }
    } catch {
      return { memories: [] };
    }
  }
}
