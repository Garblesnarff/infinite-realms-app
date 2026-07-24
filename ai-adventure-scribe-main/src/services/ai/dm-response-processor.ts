/* eslint-disable max-lines, @typescript-eslint/no-explicit-any, no-useless-escape */
import { applyAssetPostProcessing, insertAssetTags, getCachedAssets } from './asset-processor';
import { voiceConsistencyService } from '../voice-consistency-service';
import { processWorldAndMemories } from './response/world-update-processor';

import type { SessionVoiceContext } from '../voice-consistency-service';
import type { ChatMessage, NarrationSegment, GameContext, AIResponse } from './shared/types';
import type { CombatDetectionResult } from '@/utils/combatDetection';

import logger from '@/lib/logger';
import { normalizeAssetTagsInContent } from '@/utils/normalize-asset-tags';

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

  let structuredResponse: Record<string, any> | null = null;
  try {
    const cleaned = rawResponse
      .trim()
      .replace(/^```(?:json)?\s*/, '')
      .replace(/\s*```$/, '');
    structuredResponse = JSON.parse(cleaned);
  } catch {
    // Backward-compatible fallback for providers that do not support schemas.
  }
  const responseText =
    typeof structuredResponse?.text === 'string' ? structuredResponse.text : rawResponse;
  const hasStructuredResponseText = typeof structuredResponse?.text === 'string';

  // Initialize result with raw text
  let result: { text: string; narrationSegments?: NarrationSegment[] } = { text: responseText };

  // 1. Post-processing logic (Formatting & Parsing)
  if (isFirstMessage) {
    logger.info('[Opening Message] Raw AI response length:', responseText.length);
    if (hasStructuredResponseText) {
      // Structured openings use the same text field as every other DM turn.
      // Do not run legacy fence-stripping against the serialized JSON object.
      result = { text: applyAssetPostProcessing({ text: structuredResponse.text }).text };
    } else {
      // Fence-stripping is retained only for legacy plain-text providers.
      let sampledText: string;
      const entirelyWrapped = rawResponse.match(/^```\w*\n([\s\S]*)\n```\s*$/);
      if (entirelyWrapped) {
        sampledText = entirelyWrapped[1].trim();
      } else {
        sampledText = rawResponse.replace(/^\s*```[\w\s]*\n[\s\S]*?```\s*(?:\n+|$)/, '').trim();
      }
      result = { text: applyAssetPostProcessing({ text: sampledText }).text };
    }
    logger.info('[Opening Message] Sampled text length:', result.text.length);
  } else if (structuredResponse || voiceContext) {
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
      const parsedResponse = structuredResponse || JSON.parse(cleanedResponse);
      logger.debug('🎭 Successfully parsed structured voice response');

      // Map snake_case narration_segments to camelCase narrationSegments
      const narrationSegments =
        parsedResponse.narration_segments || parsedResponse.narrationSegments;

      if (narrationSegments) {
        logger.debug('📊 AI SEGMENTS ANALYSIS:', narrationSegments.length);
      }

      // Apply asset post-processing to structured response
      const assets = getCachedAssets();

      if (assets.length > 0) {
        if (parsedResponse.text) {
          parsedResponse.text = insertAssetTags(parsedResponse.text, assets);
        }
        if (narrationSegments) {
          for (const segment of narrationSegments) {
            if (segment.text) {
              segment.text = insertAssetTags(segment.text, assets);
            }
          }
        }
      }
      result = {
        text: parsedResponse.text || responseText,
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

  const looksLikeJsonSoup =
    isFirstMessage &&
    !hasStructuredResponseText &&
    (/^\s*[\[{]/.test(rawResponse) || /["']text["']\s*:/.test(rawResponse));
  if (isFirstMessage && (result.text.trim().length < 50 || looksLikeJsonSoup)) {
    logger.warn('[Opening Message] Generation failed integrity checks; using tagged fallback', {
      length: result.text.trim().length,
      looksLikeJsonSoup,
    });
    throw new Error('Opening message failed structured-output integrity checks');
  }

  // Normalize malformed asset tags before persistence, rendering, and memory extraction.
  result.text = normalizeAssetTagsInContent(result.text);
  if (structuredResponse?.combat_actions?.length) {
    result.text = result.text
      .split(/(?<=[.!?])\s+/)
      .filter(
        (sentence) =>
          !/(?:\b(?:hits?|miss(?:es|ed)?|succeeds?|fails?|critical hit|takes? \d+ (?:points? of )?damage)\b|\b(?:blade|arrow|spell|attack)\b.*\b(?:cuts?|strikes?|connects?|lands?)\b)/i.test(
            sentence,
          ),
      )
      .join(' ')
      .trim();
  }
  if (result.narrationSegments) {
    result.narrationSegments = result.narrationSegments.map((segment) => ({
      ...segment,
      text: segment.text ? normalizeAssetTagsInContent(segment.text) : segment.text,
    }));
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

  // 3. Process world and memory updates (XML-tagged or fallback)
  result.text = await processWorldAndMemories({
    text: result.text,
    context,
    message,
    conversationHistory,
    userPlan,
    turnCount,
  });

  // 4. Wrap everything into AIResponse
  const transition = structuredResponse?.combat_transition as 'none' | 'start' | 'end' | undefined;
  const combatantEntries = structuredResponse?.combatants || [];
  const monsterCatalog = combatantEntries.length
    ? new Map(
        (await import('@/services/encounters/srd-loader'))
          .loadMonsters()
          .flatMap((monster) => [
            [monster.id.toLowerCase(), monster] as const,
            [monster.name.toLowerCase(), monster] as const,
          ]),
      )
    : new Map();
  const structuredEnemies = combatantEntries.flatMap((entry: any) => {
    const monster = monsterCatalog.get(String(entry.monster_id || entry.name).toLowerCase());
    if (!monster) return [];
    return Array.from({ length: Math.max(1, Number(entry.count) || 1) }, () => ({
      monsterId: monster.id,
      name: monster.name,
      type: ['humanoid', 'beast', 'undead', 'dragon', 'construct'].includes(monster.type || '')
        ? monster.type
        : 'unknown',
      estimatedCR: String(monster.cr),
      description: `${monster.size || ''} ${monster.type || ''}`.trim(),
      suggestedHP: monster.hitPoints || 1,
      suggestedAC: monster.armorClass || 10,
    }));
  });
  const enhancedResult: AIResponse = {
    ...result,
    options: structuredResponse?.options,
    roll_requests: structuredResponse?.roll_requests || roll_requests,
    dice_rolls,
    combat_transition: transition || 'none',
    scene_spec: structuredResponse?.scene_spec ?? null,
    map_actions: structuredResponse?.map_actions || [],
    handout_actions: structuredResponse?.handout_actions || [],
    combat_actions: structuredResponse?.combat_actions || [],
    combatants: structuredResponse?.combatants || [],
    combatDetection: {
      isCombat:
        transition === 'start' ? true : transition === 'end' ? false : combatDetection.isCombat,
      confidence: combatDetection.confidence,
      combatType: combatDetection.combatType,
      shouldStartCombat: transition === 'start',
      shouldEndCombat: transition === 'end',
      enemies: structuredEnemies.length ? structuredEnemies : combatDetection.enemies || [],
      combatActions: combatDetection.combatActions || [],
    },
  };

  return enhancedResult;
}
