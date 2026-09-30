import type { Campaign } from '@/types/campaign';
import type { Character } from '@/types/character';
import type { Memory, MemoryType } from '@/types/memory';

import logger from '@/lib/logger';
import { sanitizeForMemoryExtraction } from '@/utils/memory/segmentation';
import { cleanupPlainNarrativeText } from '@/utils/narrative-text-cleanup';
import { extractNarrativeContent } from '@/utils/parseMessageOptions';
import { SentenceSegmenter } from '@/utils/sentence-segmenter';

/**
 * Creates foundational memories for a new game session.
 */
export const createInitialMemories = async (
  sessionId: string,
  character: Character,
  campaign: Campaign,
  greetingText: string,
  onMemoryCreated: (memory: Omit<Memory, 'id' | 'created_at' | 'updated_at'>) => Promise<void>,
  options: { skipOpeningScene?: boolean } = {},
) => {
  try {
    logger.info('[Initial Greeting] Creating foundational memories');

    // Importance is on the 1-10 scale; these were 5/4/4/3 on the old 1-5 scale, mapped per #2283.

    // Create character introduction memory
    await onMemoryCreated({
      session_id: sessionId,
      type: 'character_moment' as MemoryType,
      subcategory: 'player',
      content: `${character.name}, a ${character.race?.name || character.race} ${character.class?.name || character.class} of level ${character.level || 1}, begins their adventure. Background: ${character.background?.name || character.background || 'Unknown'}.`,
      importance: 9,
      metadata: {
        character_id: character.id,
        character_name: character.name,
        is_player_character: true,
        is_initial_memory: true,
      },
    });

    // Create campaign world memory
    await onMemoryCreated({
      session_id: sessionId,
      type: 'world_detail' as MemoryType,
      subcategory: 'general',
      content: `Campaign: ${campaign.name || 'Untitled Adventure'}. ${campaign.description || 'A world of adventure awaits.'}`,
      importance: 7,
      metadata: {
        campaign_id: campaign.id,
        campaign_name: campaign.name,
        is_initial_memory: true,
      },
    });

    // Create opening scene memory from the DM's greeting unless an existing
    // poisoned row was updated in place during fallback regeneration.
    if (!options.skipOpeningScene) {
      await onMemoryCreated({
        session_id: sessionId,
        type: 'location' as MemoryType,
        subcategory: 'current_location',
        content: `Opening Scene: ${greetingText}`,
        importance: 7,
        metadata: {
          scene_type: 'opening',
          is_initial_memory: true,
          turn_count: 0,
        },
      });
    }

    // Create atmosphere memory
    const atmosphereContent = extractAtmosphereFromGreeting(greetingText);
    if (atmosphereContent) {
      await onMemoryCreated({
        session_id: sessionId,
        type: 'atmosphere' as MemoryType,
        subcategory: 'environment',
        content: atmosphereContent,
        importance: 5,
        metadata: {
          scene_type: 'opening',
          is_initial_memory: true,
        },
      });
    }

    logger.info('[Initial Greeting] Successfully created all foundational memories');
  } catch (error) {
    logger.error('[Initial Greeting] Error creating initial memories:', error);
    // Don't throw here - memory creation failure shouldn't break the greeting flow
  }
};

/**
 * Extracts atmospheric details from the DM's greeting message.
 */
export const extractAtmosphereFromGreeting = (greetingText: string): string | null => {
  const cleanNarrativeText = sanitizeForMemoryExtraction(extractNarrativeContent(greetingText))
    .replace(/^(?:[-*]{3,}\s*)+/, '')
    .trim();

  // Simple extraction of atmospheric details from the greeting
  // This could be enhanced with more sophisticated parsing
  const sentences = SentenceSegmenter.splitIntoSentences(cleanNarrativeText)
    .map((sentence) =>
      cleanupPlainNarrativeText(sentence)
        .replace(/^[-—–]+\s*/, '')
        .replace(/^["“”]+|["“”]+$/g, '')
        .trim(),
    )
    .filter((s) => s.length > 0);

  const atmosphericPatterns = [
    /^(?:the\s+)?air\b/i,
    /^(?:the\s+)?floor(?:boards)?\b/i,
    /^(?:the\s+)?hallway\b/i,
    /^(?:the\s+)?room\b/i,
    /^(?:the\s+)?kitchen\b/i,
    /^(?:the\s+)?light(?:ing)?\b/i,
    /^(?:the\s+)?walls?\b/i,
    /^(?:the\s+)?ceiling\b/i,
    /^(?:the\s+)?shadows?\b/i,
    /^(?:the\s+)?heat\b/i,
    /^(?:the\s+)?steam\b/i,
    /\bsmells?\b/i,
    /\bscent\b/i,
    /\bozone\b/i,
    /\bhums?\b/i,
    /\bglow(?:ing)?\b/i,
    /\bwarm\b/i,
    /\bcold\b/i,
  ];

  const characterActionPattern =
    /\b(?:he|she|they|i|balthazar|remy|whisper|dishwasher prime|lord diabolo|saint celestia)\b/i;

  const atmosphericSentences = sentences
    .filter((sentence) => atmosphericPatterns.some((pattern) => pattern.test(sentence)))
    .filter((sentence) => !/["“”]/.test(sentence))
    .filter((sentence) => !characterActionPattern.test(sentence))
    .slice(0, 4);

  return atmosphericSentences.length > 0
    ? `Initial atmosphere: ${atmosphericSentences.join(' ').trim()}`
    : null;
};
