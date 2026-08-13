import { MemoryManager } from '../../memory-manager';
import { WorldBuilderService, WorldBuilderRepository } from '../../world-builders';
import { parseXMLTagsFromResponse } from '../xml-parser';

import type { MemoryContext } from '../../memory-manager';
import type { GameContext, ChatMessage } from '../shared/types';

import { llmApiClient } from '@/infrastructure/api';
import logger from '@/lib/logger';
import { sanitizeForMemoryExtraction } from '@/utils/memory/segmentation';

interface WorldUpdateParams {
  text: string;
  context: GameContext;
  message: string;
  conversationHistory?: ChatMessage[];
  userPlan?: string;
  turnCount?: number;
}

/**
 * Extracted from dm-response-processor.ts
 * Processes XML tags for memories and world updates, or falls back to traditional extraction.
 */
export async function processWorldAndMemories(params: WorldUpdateParams): Promise<string> {
  const { text, context, message, conversationHistory, userPlan, turnCount } = params;

  if (!context.sessionId) {
    return text;
  }

  // Preserve chronological continuity even when older events are not similar to
  // the current embedding query. Every 20 turns, store an abstractive campaign summary.
  if (turnCount !== undefined && turnCount > 0 && turnCount % 20 === 0) {
    try {
      const transcript = [
        ...(conversationHistory || []).slice(-40),
        {
          role: 'assistant' as const,
          content: text,
        },
      ]
        .map((entry) => `${entry.role}: ${sanitizeForMemoryExtraction(entry.content)}`)
        .join('\n');
      const summary = await llmApiClient.extractMemories(
        `Summarize this D&D campaign chronologically. Preserve resolved quests, named NPC relationships, locations, important items, promises, deaths, and unresolved threats. Return only the concise summary.\n\n${transcript}`,
        1200,
      );
      if (summary.trim()) {
        await MemoryManager.saveMemories([
          {
            session_id: context.sessionId,
            campaign_id: context.campaignId,
            content: summary.trim(),
            type: 'story_beat',
            memory_type: 'campaign_summary',
            importance: 5,
            metadata: { source: 'periodic_summary', turn: turnCount },
          },
        ]);
      }
    } catch (summaryError) {
      logger.warn('Periodic campaign summarization failed (non-fatal):', summaryError);
    }
  }

  // Parse XML tags from the response
  const xmlParsed = parseXMLTagsFromResponse(text);

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
        logger.info(`🧠 Saved ${memoriesToSave.length} memories from XML tags (no extra API call)`);
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

        if (!context.userId) {
          logger.warn('[WorldBuilder] Skipping XML world updates without a user ID');
        } else {
          for (const npc of xmlParsed.worldUpdates.npcs) {
            if (
              await WorldBuilderRepository.saveNPCFromXML(
                context.campaignId,
                context.sessionId!,
                npc,
                context.userId,
              )
            ) {
              savedNPCs++;
            }
          }
          for (const loc of xmlParsed.worldUpdates.locations) {
            if (
              await WorldBuilderRepository.saveLocationFromXML(
                context.campaignId,
                context.sessionId!,
                loc,
                context.userId,
              )
            ) {
              savedLocations++;
            }
          }
          for (const quest of xmlParsed.worldUpdates.quests) {
            if (
              await WorldBuilderRepository.saveQuestFromXML(
                context.campaignId,
                context.sessionId!,
                quest,
                context.userId,
              )
            ) {
              savedQuests++;
            }
          }
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

    // Return the clean narrative without XML tags
    return xmlParsed.narrative;
  }

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
        sanitizeForMemoryExtraction(text),
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
    const worldExpansion = context.userId
      ? await WorldBuilderService.respondToPlayerAction(
          context.campaignId,
          context.sessionId!,
          context.characterId,
          message,
          text,
          context.userId,
        )
      : null;

    if (
      worldExpansion &&
      worldExpansion.locations.length + worldExpansion.npcs.length + worldExpansion.quests.length >
        0
    ) {
      logger.info(
        `🌍 World expanded (fallback): +${worldExpansion.locations.length} locations, +${worldExpansion.npcs.length} NPCs, +${worldExpansion.quests.length} quests`,
      );
    }
  } catch (worldError) {
    logger.warn('World building failed (non-fatal):', worldError);
  }

  return text;
}
