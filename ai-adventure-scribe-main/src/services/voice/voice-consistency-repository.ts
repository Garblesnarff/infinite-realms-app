import type { CastingSegment, CastSegment } from '../../../shared/npc-voices';
/**
 * Voice Consistency Repository
 *
 * Data access layer for character-to-voice mappings.
 * Handles authenticated server API interactions for persistent voice consistency.
 *
 * @author AI Dungeon Master Team
 */

import logger from '@/lib/logger';
import { issue1784Api, type Issue1784VoiceMappingRow } from '@/services/issue-1784-api';
import { parseJsonIfString } from '@/utils/parse-json-if-string';

function readVoiceMappingsPayload(value: unknown, sessionId: string): Issue1784VoiceMappingRow[] {
  let parsed: unknown = value;

  if (typeof value === 'string') {
    try {
      parsed = parseJsonIfString(value);
    } catch {
      logger.error('VOICE_MAPPINGS_UNREADABLE', { sessionId });
      return [];
    }
  } else if (value !== null && typeof value === 'object') {
    parsed = value;
  } else {
    logger.error('VOICE_MAPPINGS_UNREADABLE', { sessionId, shape: typeof value });
    return [];
  }

  if (!Array.isArray(parsed)) {
    logger.error('VOICE_MAPPINGS_UNREADABLE', { sessionId });
    return [];
  }

  return parsed as Issue1784VoiceMappingRow[];
}

export class VoiceConsistencyRepository {
  static castSegments(sessionId: string, segments: CastingSegment[]): Promise<CastSegment[]> {
    return issue1784Api.castVoices(
      sessionId,
      segments.map((segment) => ({
        type:
          segment.type === 'dialogue'
            ? 'character'
            : segment.type === 'narration'
              ? 'dm'
              : segment.type,
        text: segment.text,
        character: segment.character,
        voice_category: segment.voice_category,
        npc_id: segment.npc_id,
      })),
    );
  }

  /**
   * Get voice mappings for a session
   * Retrieves all character voice mappings for this specific session
   */
  static async getSessionMappings(sessionId: string): Promise<
    Array<{
      id: string;
      characterName: string;
      voiceCategory: string | null;
      voiceId: string | null;
      lastUsed: Date;
      appearanceCount: number;
    }>
  > {
    try {
      const data = readVoiceMappingsPayload(
        await issue1784Api.getVoiceMappings(sessionId),
        sessionId,
      );

      if (!data || data.length === 0) {
        logger.debug(`No voice mappings found for session: ${sessionId}`);
        return [];
      }

      // Transform to the expected format
      return data.map((mapping) => ({
        id: mapping.id,
        characterName: mapping.character_name,
        voiceCategory: mapping.voice_category,
        voiceId: mapping.voice_id,
        lastUsed: new Date(mapping.last_used || mapping.updated_at || Date.now()),
        appearanceCount: mapping.appearance_count || 1,
      }));
    } catch (error) {
      logger.error('Error getting session mappings:', {
        message: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : typeof error,
        status: (error as { status?: unknown })?.status,
      });
      return [];
    }
  }
}
