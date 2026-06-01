/**
 * Narration Service
 *
 * Handles DM chat interactions, opening messages, and narrative generation.
 * The core storytelling engine for AI-powered D&D sessions.
 * Extracted from ai-service.ts (lines reduced from ~700 to <200).
 *
 * @module narration-service
 */

import { MemoryManager } from '../memory-manager';
import { generateGeminiResponse } from './narration-service-impl';
import { keyFor, getOrCreateDeduped } from './shared/utils';

import type { Memory } from '../memory-manager';
import type { SessionVoiceContext } from '../voice-consistency-service';
import type { ChatMessage, GameContext, AIResponse } from './shared/types';

import logger from '@/lib/logger';
import { detectCombatFromText } from '@/utils/combatDetection';

/**
 * Parameters for chatWithDM function
 */
interface ChatParams {
  message: string;
  context: GameContext;
  conversationHistory?: ChatMessage[];
  onStream?: (chunk: string) => void;
}

/**
 * Chat with AI Dungeon Master
 *
 * Simplified chat with AI DM for MVP with fallback and streaming support.
 * Uses a single AI call instead of complex agent system.
 * Includes voice segmentation for multi-voice narration.
 *
 * @param params - Chat parameters including message, context, and history
 * @returns AI response with text, narration segments, and combat detection
 */
export async function chatWithDM(params: ChatParams): Promise<AIResponse> {
  // Dedupe in-flight chat calls (2s TTL)
  const key = keyFor(
    params.context?.sessionId,
    params.message,
    (params.conversationHistory || []).length,
  );

  return getOrCreateDeduped(key, async () => {
    try {
      // Retrieve relevant memories to enhance context
      let relevantMemories: Memory[] = [];
      if (params.context.sessionId) {
        try {
          relevantMemories = await MemoryManager.getRelevantMemories(
            params.context.sessionId,
            params.message,
            8,
          );
          logger.info(`📚 Retrieved ${relevantMemories.length} relevant memories`);
        } catch (memoryError) {
          logger.warn('Failed to retrieve memories:', memoryError);
        }
      }

      // Voice context temporarily disabled for option button testing
      const voiceContext: SessionVoiceContext | null = null;

      // Detect combat from player message
      const combatDetection = detectCombatFromText(params.message);
      logger.info(
        `⚔️ Combat detection: ${combatDetection.isCombat ? 'YES' : 'NO'} (confidence: ${Math.round(combatDetection.confidence * 100)}%)`,
      );

      if (combatDetection.isCombat) {
        logger.info(`🎯 Combat details:`, {
          type: combatDetection.combatType,
          shouldStart: combatDetection.shouldStartCombat,
          shouldEnd: combatDetection.shouldEndCombat,
          enemies: combatDetection.enemies?.length || 0,
          actions: combatDetection.combatActions?.length || 0,
        });
      }

      // Use OpenRouter API
      return await generateGeminiResponse(params, relevantMemories, voiceContext, combatDetection);
    } catch (geminiError) {
      logger.error('Local Gemini API failed:', geminiError);
      throw new Error('Failed to get DM response - AI service unavailable');
    }
  });
}

// Due to length constraints, generateGeminiResponse is continued in narration-service-impl.ts
export { generateGeminiResponse } from './narration-service-impl';
