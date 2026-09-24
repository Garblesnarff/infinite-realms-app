import { MemoryImportanceService } from './MemoryImportanceService';
import { MemoryRepository } from './MemoryRepository';

import { llmApiClient } from '@/infrastructure/api';
import type { TurnPhaseReporter } from '@/infrastructure/api/rest-client';
import { stripAssetTags } from '@/lib/utils';
import {
  normalizeMemoryType,
  type Memory as UIMemory,
  type MemoryType as UIMemoryType,
} from '@/types/memory';
import { sanitizeForMemoryExtraction } from '@/utils/memory/segmentation';

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
const importanceService = new MemoryImportanceService();

export class MemoryService {
  static async saveMemories(
    memories: Array<Omit<Memory, 'id' | 'created_at' | 'updated_at'>>,
  ): Promise<void> {
    if (!memories?.length) return;
    // No embedding is attached here on purpose: the server generates it from the content it
    // receives (#1822). What the browser sends is what the memory is.
    const toInsert = memories.map((m) => {
      const content = stripAssetTags(m.content);
      const rawImportance = (m as unknown as Record<string, unknown>).importance;
      const type = normalizeMemoryType((m as unknown as Record<string, unknown>).type ?? 'general');
      const category = (m as unknown as Record<string, unknown>).category ?? 'general';
      const evaluated = importanceService.evaluate(content, type, String(category));
      const importance = typeof rawImportance === 'number' ? rawImportance : evaluated.importance;
      return {
        ...m,
        content,
        type,
        importance: Math.max(1, Math.min(5, importance)),
      };
    });
    await repository.insertMemories(toInsert as Array<Record<string, any>>);
  }

  /**
   * Recall for the DM's next turn: the session's most important memories.
   *
   * This is what live play has always actually done. The similarity branch that used to sit
   * in front of it embedded the query in the browser behind a flag that was off in
   * production, against a column that had never held a vector (#1822) — it could not have
   * returned a match. Similarity recall comes back in PR3, where the server embeds the query
   * and matches against the vectors PR2 finally writes.
   */
  static async getRelevantMemories(
    sessionId: string,
    _query: string,
    limit = 10,
  ): Promise<Memory[]> {
    return repository.loadTopMemories(sessionId, limit);
  }

  /**
   * Ask the server to extract memories from this exchange, and do not wait for it (#2148).
   *
   * The server owns the job: it calls the model, parses the reply, and writes the rows itself.
   * This used to wait for the model's text and save the memories from the browser, but the
   * browser gave up at 10 s and the model takes 13–44 s, so no production turn ever got its
   * memories. Returns immediately; the submit never rejects.
   */
  static extractMemories(
    context: MemoryContext,
    userMessage: string,
    aiResponse: string,
    onTurnPhase?: TurnPhaseReporter,
  ): void {
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

    const job = {
      sessionId: context.sessionId,
      characterId: context.characterId || undefined,
      kind: 'memories' as const,
      prompt: extractionPrompt,
      maxTokens: 1000,
    };
    void (onTurnPhase
      ? llmApiClient.submitMemoryExtraction(job, onTurnPhase)
      : llmApiClient.submitMemoryExtraction(job));
  }
}
