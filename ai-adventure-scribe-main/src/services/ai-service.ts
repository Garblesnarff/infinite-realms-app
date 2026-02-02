import { supabase } from '@/integrations/supabase/client';
import { llmApiClient } from '@/services/llm-api-client';
import { MemoryManager, MemoryContext } from './memory-manager';
import type { Memory } from './memory-manager';
import { WorldBuilderService } from './world-builders/world-builder-service';
import { voiceConsistencyService } from './voice-consistency-service';
import type { SessionVoiceContext } from './voice-consistency-service';
import { detectCombatFromText, type CombatDetectionResult } from '@/utils/combatDetection';
import logger from '@/lib/logger';
import { getLoreKeeperService } from '@/agents/services/lore-keeper/LoreKeeperService';
import { generateCampaignDescription, generateCampaignName } from './ai/campaign-generator';
import { sampleFromVerbalizedResponse } from './ai/shared/verbalized-sampling';
import { SessionStateService } from './session-state-service';
import { AgentOrchestrator } from './crewai/agent-orchestrator';
import type { RollRequest } from '@/components/game/DiceRollRequest';
import migrationMonitoringService from './migration-monitoring';

// Extracted modules for better maintainability
import { buildPaymentRequiredFallback } from './ai/roll-fallback';
import { parseXMLTagsFromResponse } from './ai/xml-parser';
import { getClassEquipment } from './ai/class-equipment';
import { ContextBuilder } from './ai/context-builder';
import { ChatPersistence } from './ai/chat-persistence';
import { deduplicateParagraphs } from './ai/response-deduplicator';
import {
  fetchCampaignAssetsForPrompt,
  applyAssetPostProcessing,
  insertAssetTags,
  getCachedAssets
} from './ai/asset-processor';
import type {
  ChatMessage,
  NarrationSegment,
  GameContext
} from './ai/shared/types';

// Type-only import for LegacyChatMessage (doesn't load the module)
type LegacyChatMessage = {
  id: string;
  role: string;
  content: string;
  timestamp: Date;
  narrationSegments?: any[];
};

// In-flight request deduplication with 2s TTL
const inFlight = new Map<string, { ts: number; promise: Promise<any> }>();
const DEDUPE_MS = 2000;

// Helper for request deduplication key
function keyFor(sessionId: string | undefined, message: string, historyLen: number) {
  return `${sessionId || 'nosession'}|${message.slice(0, 256)}|${historyLen}`;
}

export class AIService {
  /** Feature flag to enable CrewAI orchestrator integration. */
  private static useCrewAI(): boolean {
    try {
      const raw = String((import.meta as any).env?.VITE_USE_CREWAI_DM ?? '')
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
      const raw = String((import.meta as any).env?.VITE_FEATURE_USE_LANGGRAPH ?? '')
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
    roll_requests?: import('@/components/game/DiceRollRequest').RollRequest[];
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
        // if (params.context.sessionId) {
        //   try {
        //     voiceContext = await voiceConsistencyService.getSessionVoiceContext(params.context.sessionId);
        //     logger.info(`🎭 Retrieved voice context for ${Object.keys(voiceContext.knownCharacters).length} known characters`);
        //   } catch (voiceError) {
        //     logger.warn('Failed to retrieve voice context:', voiceError);
        //   }
        // }

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
            const rollRequests = (crewResult as any).roll_requests || [];
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
            if (params.context.sessionId) {
              // Graceful degradation: free tier only extracts memories every 3rd turn
              const shouldExtractMemory =
                params.userPlan === 'pro' ||
                params.userPlan === 'enterprise' ||
                !params.userPlan || // Default to extracting if plan is unknown
                (params.turnCount !== undefined && params.turnCount % 3 === 0);

              if (shouldExtractMemory) {
                try {
                  const memoryContext = {
                    sessionId: params.context.sessionId,
                    campaignId: params.context.campaignId,
                    characterId: params.context.characterId,
                    currentMessage: params.message,
                    recentMessages:
                      params.conversationHistory?.slice(-5).map((msg) => msg.content) || [],
                  };
                  const extractionResult = await MemoryManager.extractMemories(
                    memoryContext,
                    params.message,
                    finalText,
                  );
                  if (extractionResult.memories.length > 0) {
                    await MemoryManager.saveMemories(extractionResult.memories);
                    logger.info(
                      `🧠 Extracted and saved ${extractionResult.memories.length} memories (CrewAI path)`,
                    );
                  }
                } catch (memoryError) {
                  logger.warn('Memory extraction (CrewAI path) failed (non-fatal):', memoryError);
                }
              } else {
                logger.info(
                  `⏭️ Skipping memory extraction for free tier (turn ${params.turnCount}, next extraction on turn ${params.turnCount ? Math.ceil((params.turnCount + 1) / 3) * 3 : 'unknown'})`,
                );
              }

              try {
                const worldExpansion = await WorldBuilderService.respondToPlayerAction(
                  params.context.campaignId,
                  params.context.sessionId!,
                  params.context.characterId,
                  params.message,
                  finalText,
                );
                if (
                  worldExpansion &&
                  worldExpansion.locations.length +
                    worldExpansion.npcs.length +
                    worldExpansion.quests.length >
                    0
                ) {
                  logger.info(
                    `🌍 World expanded (CrewAI): +${worldExpansion.locations.length} locations, +${worldExpansion.npcs.length} NPCs, +${worldExpansion.quests.length} quests`,
                  );
                }
              } catch (worldError) {
                logger.warn('World building (CrewAI path) failed (non-fatal):', worldError);
              }
            }

            const enhancedCrewResult = {
              ...crewResult,
              text: finalText,
              combatDetection: {
                isCombat: combatDetection.isCombat,
                confidence: combatDetection.confidence,
                combatType: combatDetection.combatType,
                shouldStartCombat: combatDetection.shouldStartCombat,
                shouldEndCombat: combatDetection.shouldEndCombat,
                enemies: combatDetection.enemies || [],
                combatActions: combatDetection.combatActions || [],
              },
            } as any;

            return enhancedCrewResult;
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

        // Initialize result with raw text
        let result: { text: string, narration_segments?: NarrationSegment[] } = { text: rawResponse };

        // Post-processing logic
        if (isFirstMessage) {
            logger.info('[Opening Message] Raw AI response length:', rawResponse.length);
            const sampledText = sampleFromVerbalizedResponse(rawResponse);
            logger.info('[Opening Message] Sampled text length:', sampledText.length);
            result = applyAssetPostProcessing({ text: sampledText });
        } else if (voiceContext) {
             try {
                // Clean the response by removing markdown code blocks first
                let cleanedResponse = rawResponse.trim();
                cleanedResponse = cleanedResponse
                  .replace(/^```(?:json)?\s*/, '')
                  .replace(/\s*```$/, '');

                // Try to find JSON content if the response has extra text
                const jsonStart = cleanedResponse.indexOf('{');
                const jsonEnd = cleanedResponse.lastIndexOf('}');

                if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
                  cleanedResponse = cleanedResponse.substring(jsonStart, jsonEnd + 1);
                }

                // Additional cleanup for common JSON formatting issues
                cleanedResponse = cleanedResponse
                  .replace(/,\s*}/g, '}') // Remove trailing commas before }
                  .replace(/,\s*]/g, ']') // Remove trailing commas before ]
                  .replace(/}\s*{/g, '},{') // Fix missing commas between objects
                  .replace(/"\s*:\s*"([^"]*?)"\s*([,}])/g, '":"$1"$2'); // Fix spacing issues

                // Parse the cleaned JSON
                const structuredResponse = JSON.parse(cleanedResponse);
                logger.debug('🎭 Successfully parsed structured voice response');

                if (structuredResponse.narration_segments) {
                  logger.debug('📊 AI SEGMENTS ANALYSIS:', structuredResponse.narration_segments.length);
                }

                // Apply asset post-processing to structured response
                const assets = getCachedAssets()?.assets;
                if (assets && assets.length) {
                  if (structuredResponse.text) {
                    structuredResponse.text = insertAssetTags(structuredResponse.text, assets);
                  }
                  if (structuredResponse.narration_segments) {
                    structuredResponse.narration_segments = structuredResponse.narration_segments.map(
                      (segment: NarrationSegment) => ({
                        ...segment,
                        text: segment.text ? insertAssetTags(segment.text, assets) : segment.text
                      })
                    );
                  }
                }
                result = structuredResponse;
             } catch (parseError) {
                logger.warn(
                  'Failed to parse structured response, attempting to extract text:',
                  parseError,
                );

                // Try to extract text from malformed JSON
                try {
                  // Look for text field in the response even if JSON is malformed
                  const textMatch = rawResponse.match(/"text"\s*:\s*"([\s\S]*?)"(?=\s*[,}])/);
                  if (textMatch) {
                    const extractedText = textMatch[1]
                      .replace(/\\"/g, '"')
                      .replace(/\\n/g, '\n')
                      .replace(/\\\\/g, '\\');
                    logger.debug('🔧 Extracted text from malformed JSON');
                    result = applyAssetPostProcessing({ text: extractedText });
                  } else {
                    // Final fallback - return raw response with minimal cleaning
                    let cleanText = rawResponse;
                    if (cleanText.trim().startsWith('{') && cleanText.includes('"text"')) {
                      // Try to find where the actual text content starts and ends
                      const startMatch = cleanText.match(/"text"\s*:\s*"/);
                      if (startMatch) {
                        const startIndex = startMatch.index! + startMatch[0].length;
                        let textContent = cleanText.substring(startIndex);
                        const endMatch = textContent.match(/"\s*[,}]/);
                        if (endMatch) {
                          textContent = textContent.substring(0, endMatch.index);
                        } else {
                          const lastQuoteIndex = textContent.lastIndexOf('"');
                          if (lastQuoteIndex > 0) {
                            textContent = textContent.substring(0, lastQuoteIndex);
                          }
                        }
                        cleanText = textContent
                          .replace(/\\"/g, '"')
                          .replace(/\\n/g, '\n')
                          .replace(/\\\\/g, '\\');
                      }
                    }
                    result = applyAssetPostProcessing({ text: cleanText || rawResponse });
                  }
                } catch (extractError) {
                  logger.warn('Could not extract text from malformed JSON:', extractError);
                  result = applyAssetPostProcessing({ text: rawResponse });
                }
             }
        } else {
             result = applyAssetPostProcessing({ text: rawResponse });
        }

        logger.info('Successfully generated DM response using local Gemini API');

        // Process voice assignments if we have structured data
        if (result.narration_segments && params.context.sessionId && voiceContext) {
          try {
            // Normalize segment types for compatibility
            type VoiceSegment = {
              type: string;
              text: string;
              character?: string;
              voice_category?: string;
            };
            const normalizedSegments: VoiceSegment[] = result.narration_segments.map(
              (segment: NarrationSegment) => ({
                ...segment,
                type:
                  segment.type === 'dm'
                    ? 'narration'
                    : segment.type === 'character'
                      ? 'dialogue'
                      : (segment.type as string),
              }),
            );

            await voiceConsistencyService.processVoiceAssignments(
              params.context.sessionId,
              normalizedSegments,
            );
            logger.info('🎪 Processed voice assignments for character consistency');
          } catch (voiceError) {
            logger.warn('Voice assignment processing failed (non-fatal):', voiceError);
          }
        }

        // ========================================================================
        // PHASE 2: XML-TAGGED MEMORY AND WORLD EXTRACTION
        // ========================================================================
        if (params.context.sessionId) {
          // Parse XML tags from the response
          const xmlParsed = parseXMLTagsFromResponse(result.text);

          // If XML tags were found, use them directly (no additional API calls!)
          if (xmlParsed.hadTags) {
            logger.info(`📋 Found XML tags in DM response: ${xmlParsed.memories.length} memories, ${xmlParsed.worldUpdates.npcs.length} NPCs, ${xmlParsed.worldUpdates.locations.length} locations, ${xmlParsed.worldUpdates.quests.length} quests`);

            // Store memories from XML tags (no API call needed)
            if (xmlParsed.memories.length > 0) {
              try {
                const memoriesToSave = xmlParsed.memories.map((content) => ({
                  session_id: params.context.sessionId!,
                  campaign_id: params.context.campaignId,
                  content,
                  type: 'event',
                  memory_type: 'story_event',
                  importance: 4,
                  metadata: { source: 'xml_extraction', characterId: params.context.characterId },
                }));
                await MemoryManager.saveMemories(memoriesToSave);
                logger.info(`🧠 Saved ${memoriesToSave.length} memories from XML tags (no extra API call)`);
              } catch (memoryError) {
                logger.warn('Failed to save XML-extracted memories (non-fatal):', memoryError);
              }
            }

            // Process world updates from XML tags
            const hasWorldUpdates = xmlParsed.worldUpdates.npcs.length > 0 ||
              xmlParsed.worldUpdates.locations.length > 0 ||
              xmlParsed.worldUpdates.quests.length > 0;

            if (hasWorldUpdates) {
              try {
                for (const npc of xmlParsed.worldUpdates.npcs) {
                  await WorldBuilderService.saveNPCFromXML(
                    params.context.campaignId,
                    params.context.sessionId!,
                    npc,
                  );
                }
                for (const loc of xmlParsed.worldUpdates.locations) {
                  await WorldBuilderService.saveLocationFromXML(
                    params.context.campaignId,
                    params.context.sessionId!,
                    loc,
                  );
                }
                for (const quest of xmlParsed.worldUpdates.quests) {
                  await WorldBuilderService.saveQuestFromXML(
                    params.context.campaignId,
                    params.context.sessionId!,
                    quest,
                  );
                }
                logger.info(`🌍 World expanded from XML: +${xmlParsed.worldUpdates.locations.length} locations, +${xmlParsed.worldUpdates.npcs.length} NPCs, +${xmlParsed.worldUpdates.quests.length} quests`);
              } catch (worldError) {
                logger.warn('Failed to save XML-extracted world updates (non-fatal):', worldError);
              }
            }

            // Update result.text to be the clean narrative without XML tags
            result.text = xmlParsed.narrative;
          } else {
            // No XML tags found - fall back to traditional extraction
            logger.info('⚠️ No XML tags found in DM response, using fallback extraction');

            const shouldExtractMemory =
              params.userPlan === 'pro' ||
              params.userPlan === 'enterprise' ||
              !params.userPlan ||
              (params.turnCount !== undefined && params.turnCount % 3 === 0);

            if (shouldExtractMemory) {
              try {
                const memoryContext: MemoryContext = {
                  sessionId: params.context.sessionId,
                  campaignId: params.context.campaignId,
                  characterId: params.context.characterId,
                  currentMessage: params.message,
                  recentMessages:
                    params.conversationHistory?.slice(-5).map((msg) => msg.content) || [],
                };

                const extractionResult = await MemoryManager.extractMemories(
                  memoryContext,
                  params.message,
                  result.text,
                );

                if (extractionResult.memories.length > 0) {
                  await MemoryManager.saveMemories(extractionResult.memories);
                  logger.info(`🧠 Extracted and saved ${extractionResult.memories.length} memories (fallback API call)`);
                }
              } catch (memoryError) {
                logger.warn('Memory extraction failed (non-fatal):', memoryError);
              }
            } else {
              logger.info(
                `⏭️ Skipping memory extraction for free tier (turn ${params.turnCount}, next extraction on turn ${params.turnCount ? Math.ceil((params.turnCount + 1) / 3) * 3 : 'unknown'})`,
              );
            }

            try {
              const worldExpansion = await WorldBuilderService.respondToPlayerAction(
                params.context.campaignId,
                params.context.sessionId!,
                params.context.characterId,
                params.message,
                result.text,
              );

              if (
                worldExpansion &&
                worldExpansion.locations.length +
                  worldExpansion.npcs.length +
                  worldExpansion.quests.length >
                  0
              ) {
                logger.info(
                  `🌍 World expanded (fallback): +${worldExpansion.locations.length} locations, +${worldExpansion.npcs.length} NPCs, +${worldExpansion.quests.length} quests`,
                );
              }
            } catch (worldError) {
              logger.warn('World building failed (non-fatal):', worldError);
            }
          }
        }

        // Add combat detection data to the result
        const enhancedResult = {
          ...result,
          combatDetection: {
            isCombat: combatDetection.isCombat,
            confidence: combatDetection.confidence,
            combatType: combatDetection.combatType,
            shouldStartCombat: combatDetection.shouldStartCombat,
            shouldEndCombat: combatDetection.shouldEndCombat,
            enemies: combatDetection.enemies || [],
            combatActions: combatDetection.combatActions || [],
          },
        };

        return enhancedResult;
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
    return (response as any)?.text || (response as any)?.content || 'Welcome to your adventure!';
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
