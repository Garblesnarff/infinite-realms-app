/**
 * Voice Consistency Repository
 *
 * Data access layer for character-to-voice mappings.
 * Handles authenticated server API interactions for persistent voice consistency.
 *
 * @author AI Dungeon Master Team
 */

import logger from '@/lib/logger';
import { issue1784Api } from '@/services/issue-1784-api';

export class VoiceConsistencyRepository {
  /**
   * Get voice mappings for a session
   * Retrieves all character voice mappings for this specific session
   */
  static async getSessionMappings(sessionId: string): Promise<
    Array<{
      id: string;
      characterName: string;
      voiceCategory: string;
      voiceId: string | null;
      lastUsed: Date;
      appearanceCount: number;
    }>
  > {
    try {
      const data = await issue1784Api.getVoiceMappings(sessionId);

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

  /**
   * Save a new character voice mapping
   */
  static async saveCharacterVoiceMapping(
    sessionId: string,
    characterName: string,
    voiceCategory: string,
    voiceId: string,
    initialCount: number = 1,
  ): Promise<void> {
    try {
      await issue1784Api.upsertVoiceMapping(sessionId, {
        character_name: characterName,
        voice_category: voiceCategory,
        voice_id: voiceId,
        appearance_count: initialCount,
      });

      logger.info(
        `💾 Saved voice mapping: ${characterName} -> ${voiceCategory} (count: ${initialCount})`,
      );
    } catch (error) {
      logger.error('Error saving character voice mapping:', error);
    }
  }

  /**
   * Update character usage statistics
   */
  static async updateCharacterUsage(mappingId: string, newCount: number): Promise<void> {
    try {
      // ⚡ Bolt: Optimized to perform update in a single round-trip by using the pre-calculated count.
      // This eliminates the redundant SELECT query previously performed here.
      await issue1784Api.updateVoiceMapping(mappingId, { appearance_count: newCount });

      logger.debug(`📊 Updated usage for mapping: ${mappingId} (count: ${newCount})`);
    } catch (error) {
      logger.error('Error updating character usage:', error);
    }
  }
}
