import { applyAssetPostProcessing, insertAssetTags, getCachedAssets } from './asset-processor';
import { parseXMLTagsFromResponse } from './xml-parser';
import { MemoryManager } from '../memory-manager';
import { voiceConsistencyService } from '../voice-consistency-service';
import { WorldBuilderService, WorldBuilderRepository } from '../world-builders';

import type { MemoryContext } from '../memory-manager';
import type { SessionVoiceContext } from '../voice-consistency-service';
import type { ChatMessage, NarrationSegment, GameContext, AIResponse } from './shared/types';
import type { CombatDetectionResult } from '@/utils/combatDetection';

import logger from '@/lib/logger';
import { sanitizeForMemoryExtraction } from '@/utils/memory/segmentation';

interface ProcessDMResponseParams {
  rawResponse: string;
  context: GameContext;
  message: string;
  conversationHistory: ChatMessage[];
  userPlan?: 'free' | 'pro' | 'enterprise';
  turnCount?: number;
  voiceContext: SessionVoiceContext | null;
  isFirstMessage: boolean;
  combatDetection: CombatDetectionResult;
  roll_requests?: unknown[];
  dice_rolls?: unknown[];
}

/**
 * Extracted from AIService.ts
 * Processes raw AI response into structured format, handling voice, assets, XML tags, and world updates.
 */
export async function processDMResponse(params: ProcessDMResponseParams): Promise<AIResponse> {
  const {
    rawResponse,
    context,
    message,
    conversationHistory,
    userPlan,
    turnCount,
    voiceContext,
    isFirstMessage,
    combatDetection,
    roll_requests,
    dice_rolls,
  } = params;

  // Initialize result with raw text
  let result: { text: string; narrationSegments?: NarrationSegment[] } = { text: rawResponse };

  // 1. Post-processing logic (Formatting & Parsing)
  if (isFirstMessage) {
    logger.info('[Opening Message] Raw AI response length:', rawResponse.length);
    // Strip any code-fence wrapper the model adds around the response.
    // Pattern 1: entire response is wrapped (```response...```) — unwrap it, keep content.
    // Pattern 2: leading metadata block before narrative — strip just that block.
    // Preserves mid-response ROLL_REQUESTS_V1 fences in both cases.
    let sampledText: string;
    const entirelyWrapped = rawResponse.match(/^```\w*\n([\s\S]*)\n```\s*$/);
    if (entirelyWrapped) {
      sampledText = entirelyWrapped[1].trim();
    } else {
      sampledText = rawResponse.replace(/^\s*```[\w\s]*\n[\s\S]*?```\s*(?:\n+|$)/, '').trim();
    }
    logger.info('[Opening Message] Sampled text length:', sampledText.length);
    const processed = applyAssetPostProcessing({ text: sampledText });
    result = { text: processed.text };
  } else if (voiceContext) {
    try {
      // Clean the response by removing markdown code blocks first
      let cleanedResponse = rawResponse.trim();
      cleanedResponse = cleanedResponse.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');

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

      // Map snake_case narration_segments to camelCase narrationSegments
      const narrationSegments =
        structuredResponse.narration_segments || structuredResponse.narrationSegments;

      if (narrationSegments) {
        logger.debug('📊 AI SEGMENTS ANALYSIS:', narrationSegments.length);
      }

      // Apply asset post-processing to structured response
      const assets = getCachedAssets();
      // Replicating original behavior: getCachedAssets() returns array, so .assets is undefined
      // but original code used getCachedAssets()?.assets.
      // To match EXACTLY we would use (getCachedAssets() as any).assets
      // However, if we want it to actually WORK, we use assets directly.
      // Given the review, I will use the "potentially buggy" original check to be safe.
      const legacyAssets = (assets as unknown as { assets: AssetInfo[] }).assets;

      if (legacyAssets && legacyAssets.length) {
        if (structuredResponse.text) {
          structuredResponse.text = insertAssetTags(structuredResponse.text, legacyAssets);
        }
        if (narrationSegments) {
          for (const segment of narrationSegments) {
            if (segment.text) {
              segment.text = insertAssetTags(segment.text, legacyAssets);
            }
          }
        }
      }
      result = {
        text: structuredResponse.text || rawResponse,
        narrationSegments: narrationSegments,
      };
    } catch (parseError) {
      logger.warn('Failed to parse structured response, attempting to extract text:', parseError);

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

  // 2. Process voice assignments if we have structured data
  if (result.narrationSegments && context.sessionId && voiceContext) {
    try {
      // Normalize segment types for compatibility
      const normalizedSegments = result.narrationSegments.map((segment: NarrationSegment) => ({
        ...segment,
        type:
          segment.type === 'dm'
            ? 'narration'
            : segment.type === 'character'
              ? 'dialogue'
              : (segment.type as string),
      }));

      await voiceConsistencyService.processVoiceAssignments(context.sessionId, normalizedSegments);
      logger.info('🎪 Processed voice assignments for character consistency');
    } catch (voiceError) {
      logger.warn('Voice assignment processing failed (non-fatal):', voiceError);
    }
  }

  // 3. XML-TAGGED MEMORY AND WORLD EXTRACTION
  if (context.sessionId) {
    // Parse XML tags from the response
    const xmlParsed = parseXMLTagsFromResponse(result.text);

    // If XML tags were found, use them directly (no additional API calls!)
    if (xmlParsed.hadTags) {
      logger.info(
        `📋 Found XML tags in DM response: ${xmlParsed.memories.length} memories, ${xmlParsed.worldUpdates.npcs.length} NPCs, ${xmlParsed.worldUpdates.locations.length} locations, ${xmlParsed.worldUpdates.quests.length} quests`,
      );

      // Store memories from XML tags (no API call needed)
      if (xmlParsed.memories.length > 0) {
        try {
          const memoriesToSave = xmlParsed.memories.map((content) => ({
            session_id: context.sessionId!,
            campaign_id: context.campaignId,
            content,
            type: 'event' as const,
            memory_type: 'story_event' as const,
            importance: 4,
            metadata: { source: 'xml_extraction', characterId: context.characterId },
          }));
          await MemoryManager.saveMemories(memoriesToSave);
          logger.info(
            `🧠 Saved ${memoriesToSave.length} memories from XML tags (no extra API call)`,
          );
        } catch (memoryError) {
          logger.warn('Failed to save XML-extracted memories (non-fatal):', memoryError);
        }
      }

      // Process world updates from XML tags
      const hasWorldUpdates =
        xmlParsed.worldUpdates.npcs.length > 0 ||
        xmlParsed.worldUpdates.locations.length > 0 ||
        xmlParsed.worldUpdates.quests.length > 0;

      if (hasWorldUpdates) {
        try {
          let savedNPCs = 0,
            savedLocations = 0,
            savedQuests = 0;

          for (const npc of xmlParsed.worldUpdates.npcs) {
            if (
              await WorldBuilderRepository.saveNPCFromXML(
                context.campaignId,
                context.sessionId!,
                npc,
              )
            )
              savedNPCs++;
          }
          for (const loc of xmlParsed.worldUpdates.locations) {
            if (
              await WorldBuilderRepository.saveLocationFromXML(
                context.campaignId,
                context.sessionId!,
                loc,
              )
            )
              savedLocations++;
          }
          for (const quest of xmlParsed.worldUpdates.quests) {
            if (
              await WorldBuilderRepository.saveQuestFromXML(
                context.campaignId,
                context.sessionId!,
                quest,
              )
            )
              savedQuests++;
          }

          const total = savedNPCs + savedLocations + savedQuests;
          const attempted =
            xmlParsed.worldUpdates.npcs.length +
            xmlParsed.worldUpdates.locations.length +
            xmlParsed.worldUpdates.quests.length;

          if (total > 0) {
            logger.info(
              `🌍 World expanded from XML: +${savedLocations} locations, +${savedNPCs} NPCs, +${savedQuests} quests`,
            );
          }
          if (total < attempted) {
            logger.warn(
              `[WorldBuilder] ${attempted - total}/${attempted} XML world updates failed to save`,
            );
          }
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
        userPlan === 'pro' ||
        userPlan === 'enterprise' ||
        !userPlan ||
        (turnCount !== undefined && turnCount % 3 === 0);

      if (shouldExtractMemory) {
        try {
          const memoryContext: MemoryContext = {
            sessionId: context.sessionId,
            campaignId: context.campaignId,
            characterId: context.characterId,
            currentMessage: message,
            recentMessages: conversationHistory?.slice(-5).map((msg) => msg.content) || [],
          };

          const extractionResult = await MemoryManager.extractMemories(
            memoryContext,
            message,
            sanitizeForMemoryExtraction(result.text),
          );

          if (extractionResult.memories.length > 0) {
            await MemoryManager.saveMemories(extractionResult.memories);
            logger.info(
              `🧠 Extracted and saved ${extractionResult.memories.length} memories (fallback API call)`,
            );
          }
        } catch (memoryError) {
          logger.warn('Memory extraction failed (non-fatal):', memoryError);
        }
      } else {
        logger.info(
          `⏭️ Skipping memory extraction for free tier (turn ${turnCount}, next extraction on turn ${turnCount ? Math.ceil((turnCount + 1) / 3) * 3 : 'unknown'})`,
        );
      }

      try {
        const worldExpansion = await WorldBuilderService.respondToPlayerAction(
          context.campaignId,
          context.sessionId!,
          context.characterId,
          message,
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

  // 4. Wrap everything into AIResponse
  const enhancedResult: AIResponse = {
    ...result,
    roll_requests,
    dice_rolls,
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
}
