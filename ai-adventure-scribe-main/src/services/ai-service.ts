

import { generateCampaignDescription, generateCampaignName } from './ai/campaign-generator';
import { ChatPersistence } from './ai/chat-persistence';
import { ContextBuilder } from './ai/context-builder';
import { processDMResponse } from './ai/dm-response-processor';
import { AgentOrchestrator } from './crewai/agent-orchestrator';
import { MemoryManager } from './memory-manager';
import migrationMonitoringService from './migration-monitoring';
import { SessionStateService } from './session-state-service';


import type {
  ChatMessage,
  NarrationSegment,
  GameContext
} from './ai/shared/types';
import type { Memory } from './memory-manager';
import type { SessionVoiceContext } from './voice-consistency-service';
import type { RollRequest } from '@/components/game/DiceRollRequest';

import { llmApiClient } from '@/infrastructure/api';
import logger from '@/lib/logger';
import { detectCombatFromText, type CombatDetectionResult } from '@/utils/combatDetection';

// Type-only import for LegacyChatMessage (doesn't load the module)
type LegacyChatMessage = {
  id: string;
  role: string;
  content: string;
  timestamp: Date;
  narrationSegments?: NarrationSegment[];
};

// In-flight request deduplication with 2s TTL
const inFlight = new Map<string, { ts: number; promise: Promise<AIResponse | unknown> }>();
const DEDUPE_MS = 2000;

// Helper for request deduplication key
function keyFor(sessionId: string | undefined, message: string, historyLen: number) {
  return `${sessionId || 'nosession'}|${message.slice(0, 256)}|${historyLen}`;
}

export class AIService {
  /** Feature flag to enable CrewAI orchestrator integration. */
  private static useCrewAI(): boolean {
    try {
      const raw = String((import.meta as unknown as { env: Record<string, string> }).env?.VITE_USE_CREWAI_DM ?? '')
        .toLowerCase()
        .trim();
      return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
    } catch {
      return false;
    }
  }

  /**
   * Feature flag to enable LangGraph migration.
   * When enabled, uses LangGraph-based agent system instead of custom messaging.
   */
  private static useLangGraph(): boolean {
    try {
      const raw = String((import.meta as unknown as { env: Record<string, string> }).env?.VITE_FEATURE_USE_LANGGRAPH ?? '')
        .toLowerCase()
        .trim();
      return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
    } catch {
      return false;
    }
  }
  /**
   * Generate a campaign description using AI with fallback
   * Delegates to modular campaign-generator.ts which includes verbalized sampling
   */
  static async generateCampaignDescription(params: {
    genre: string;
    difficulty: string;
    length: string;
    tone: string;
  }): Promise<string> {
    // Delegate to modular campaign generator (includes verbalized sampling)
    return generateCampaignDescription(params);
  }

  /**
   * Generate a campaign name using AI
   * Delegates to modular campaign-generator.ts which includes verbalized sampling
   */
  static async generateCampaignName(params: {
    genre: string;
    difficulty: string;
    length: string;
    tone: string;
  }): Promise<string> {
    // Delegate to modular campaign generator (includes verbalized sampling)
    return generateCampaignName(params);
  }

  /**
   * Simplified chat with AI DM for MVP with fallback and streaming support
   * Uses a single AI call instead of complex agent system
   * Now includes voice segmentation for multi-voice narration
   */
  static async chatWithDM(params: {
    message: string;
    context: GameContext;
    conversationHistory?: ChatMessage[];
    onStream?: (chunk: string) => void;
    userPlan?: 'free' | 'pro' | 'enterprise';
    turnCount?: number;
  }): Promise<{
    text: string;
    narrationSegments?: NarrationSegment[];
    roll_requests?: RollRequest[];
    dice_rolls?: unknown[];
    combatDetection?: CombatDetectionResult;
  }> {
    // Decision about path (CrewAI vs Gemini) happens below

    // Dedupe in-flight chat calls (2s TTL)
    const key = keyFor(
      params.context?.sessionId,
      params.message,
      (params.conversationHistory || []).length,
    );
    const now = Date.now();
    for (const [k, v] of inFlight) if (now - v.ts > DEDUPE_MS) inFlight.delete(k);
    if (inFlight.has(key)) {
      logger.debug('[AIService] Deduping in-flight chat call:', key);
      return inFlight.get(key)!.promise;
    }

    const p = (async () => {
      try {
        // ========================================================================
        // LANGGRAPH MIGRATION PATH (Feature Flag)
        // ========================================================================
        // If LangGraph is enabled, delegate to the new system via compatibility adapter
        if (this.useLangGraph()) {
          try {
            logger.info(
              '[AIService] Using LangGraph agent system (VITE_FEATURE_USE_LANGGRAPH=true)',
            );

            // Dynamic import to avoid loading LangGraph when feature is disabled
            const { getLegacyCompatibilityAdapter } = await import(
              '@/agents/langgraph/adapters/legacy-compatibility'
            );
            const adapter = getLegacyCompatibilityAdapter();

            // Convert ChatMessage[] to LegacyChatMessage[]
            const legacyHistory: LegacyChatMessage[] = (params.conversationHistory || []).map(
              (msg) => ({
                id: msg.id,
                role: msg.role,
                content: msg.content,
                timestamp: msg.timestamp,
                narrationSegments: msg.narrationSegments,
              }),
            );

            const result = await adapter.chatWithDM({
              message: params.message,
              context: params.context,
              conversationHistory: legacyHistory,
              onStream: params.onStream,
              userPlan: params.userPlan,
              turnCount: params.turnCount,
            });

            logger.info('[AIService] LangGraph response generated successfully');
            return result;
          } catch (langGraphError) {
            logger.error(
              '[AIService] LangGraph failed, falling back to legacy system:',
              langGraphError,
            );

            // Record fallback
            migrationMonitoringService.recordInteraction({
              system: 'langgraph',
              outcome: 'fallback',
              durationMs: 0,
              messageLength: params.message.length,
              responseLength: 0,
              errorType: langGraphError instanceof Error ? langGraphError.name : 'Unknown',
              errorMessage:
                langGraphError instanceof Error ? langGraphError.message : 'Unknown error',
              sessionId: params.context.sessionId,
              timestamp: new Date(),
            });

            // Continue to legacy path below
          }
        }

        // ========================================================================
        // LEGACY PATH (Custom Messaging + Gemini)
        // ========================================================================

        // Retrieve relevant memories to enhance context
        let relevantMemories: Memory[] = [];
        if (params.context.sessionId) {
          try {
            relevantMemories = await MemoryManager.getRelevantMemories(
              params.context.sessionId,
              params.message,
              8, // Get top 8 relevant memories
            );
            logger.info(`📚 Retrieved ${relevantMemories.length} relevant memories`);
          } catch (memoryError) {
            logger.warn('Failed to retrieve memories:', memoryError);
          }
        }

        // Get voice context for multi-voice narration
        // TEMPORARILY DISABLED for option button testing
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

        // Optional path: delegate to CrewAI orchestrator behind feature flag
        if (this.useCrewAI() && params.context.sessionId) {
          try {
            logger.info('Using CrewAI microservice for chat...');
            const sessionState = await SessionStateService.getState(params.context.sessionId);
            const crewResult = await AgentOrchestrator.generateResponse({
              message: params.message,
              context: params.context,
              conversationHistory: params.conversationHistory || [],
              sessionState,
            });

            // If CrewAI returned placeholder text, generate final prose via Gemini but keep CrewAI roll_requests
            let finalText = crewResult.text || '';
            const isPlaceholder = finalText.trim().startsWith('[CrewAI placeholder]');
            const rollRequests = crewResult.roll_requests || [];
            if (isPlaceholder) {
              // If a roll is requested, prompt the user to roll first instead of narrating outcomes
              if (Array.isArray(rollRequests) && rollRequests.length > 0) {
                const rr = rollRequests[0];
                const typeLabel =
                  rr.type === 'check'
                    ? 'Check'
                    : rr.type === 'save'
                      ? 'Saving Throw'
                      : rr.type === 'attack'
                        ? 'Attack'
                        : rr.type === 'damage'
                          ? 'Damage'
                          : 'Initiative';
                const purpose =
                  rr.purpose || (rr.type === 'check' ? 'Ability/Skill Check' : typeLabel);
                const target = rr.dc ? ` (DC ${rr.dc})` : rr.ac ? ` (AC ${rr.ac})` : '';
                const advantage = rr.advantage
                  ? ' with advantage'
                  : rr.disadvantage
                    ? ' with disadvantage'
                    : '';
                finalText = `Please roll ${purpose}${target}${advantage}.`;
              } else {
                logger.info(
                  'CrewAI returned placeholder text; generating narration via LLM.',
                );
                try {
                  const prompt = `Respond to the player succinctly (2-3 short paragraphs) and end with 2-3 lettered options. Player said: "${params.message}"`;
                  const genAIResult = await llmApiClient.generateText({
                    prompt,
                    temperature: 0.9,
                    maxTokens: 2048,
                  });
                  finalText = genAIResult || finalText;
                } catch (e) {
                  logger.warn('LLM fallback for placeholder failed, using placeholder text:', e);
                }
              }
            }

            // Post-processing parity: memory extraction and world expansion
            // Using unified processor for consistency
            return processDMResponse({
              rawResponse: finalText,
              context: params.context,
              message: params.message,
              conversationHistory: params.conversationHistory || [],
              userPlan: params.userPlan,
              turnCount: params.turnCount,
              voiceContext: null,
              isFirstMessage: false,
              combatDetection,
              roll_requests: crewResult.roll_requests,
              dice_rolls: (crewResult as unknown as { dice_rolls: unknown[] }).dice_rolls
            });
          } catch (crewError) {
            logger.warn('CrewAI orchestrator failed, falling back to Gemini:', crewError);
            // Continue to legacy path below
          }
        }

        // Use local Gemini API
        logger.info(`Using local Gemini API for chat`);

        const isFirstMessage =
            (!params.conversationHistory || params.conversationHistory.length === 0) &&
            (!params.message || params.message.trim() === '');

        // Build context prompt
        const contextPrompt = await ContextBuilder.build({
            context: params.context,
            message: params.message,
            conversationHistory: params.conversationHistory,
            relevantMemories,
            combatDetection,
            voiceContext,
            isFirstMessage
        });

        // Execute chat via llmApiClient
        // Build combined prompt from context, history, and message
        const historyContext = (params.conversationHistory || [])
          .slice(-10) // Keep last 10 messages for context
          .map(msg => `${msg.role === 'user' ? 'Player' : 'DM'}: ${msg.content}`)
          .join('\n\n');

        const fullPrompt = `${contextPrompt}\n\n${historyContext ? `<conversation_history>\n${historyContext}\n</conversation_history>\n\n` : ''}${params.message ? `Player: ${params.message}` : 'Begin the adventure. Generate the opening scene for this campaign.'}`;

        const rawResponse = await llmApiClient.generateText({
          prompt: fullPrompt,
          temperature: 0.9,
          maxTokens: 2048,
        });

        return processDMResponse({
          rawResponse,
          context: params.context,
          message: params.message,
          conversationHistory: params.conversationHistory || [],
          userPlan: params.userPlan,
          turnCount: params.turnCount,
          voiceContext,
          isFirstMessage,
          combatDetection
        });
      } catch (geminiError) {
        logger.error('Local Gemini API failed:', geminiError);
        throw new Error('Failed to get DM response - AI service unavailable');
      }
    })(); // End of the async promise wrapper

    // Store promise in in-flight map and return it
    inFlight.set(key, { ts: now, promise: p });
    return p;
  }

  /**
   * Save a chat message to the database
   */
  static async saveChatMessage(params: {
    sessionId: string;
    role: 'user' | 'assistant';
    content: string;
    speakerId?: string;
    id?: string;
  }): Promise<void> {
    return ChatPersistence.saveChatMessage(params);
  }

  /**
   * Get conversation history for a session
   */
  static async getConversationHistory(sessionId: string): Promise<ChatMessage[]> {
    return ChatPersistence.getConversationHistory(sessionId);
  }

  /**
   * Generate an opening message for a new campaign session
   * Uses chatWithDM with empty message/history to trigger first message flow
   */
  static async generateOpeningMessage(params: { context: GameContext }): Promise<string> {
    const response = await AIService.chatWithDM({
      message: '',
      context: params.context,
      conversationHistory: [],
    });

    if (typeof response === 'string') {
      return response;
    }
    return response.text || 'Welcome to your adventure!';
  }

  /**
   * Get API statistics (for debugging)
   * @deprecated API stats are no longer tracked after Gemini removal
   */
  static getApiStats(): { provider: string; status: string } {
    return {
      provider: 'openrouter',
      status: 'Using server-proxied OpenRouter API',
    };
  }
}
