/**
 * Voice Consistency Repository
 *
 * Data access layer for character-to-voice mappings.
 * Handles Supabase interactions for persistent voice consistency.
 *
 * @author AI Dungeon Master Team
 */

import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';

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
      // ⚡ Bolt: Using explicit column selection to avoid over-fetching
      // large JSONB metadata fields when listing mappings.
      const { data, error } = await supabase
        .from('character_voice_mappings')
        .select(
          'id, character_name, voice_category, voice_id, last_used, updated_at, appearance_count',
        )
        .eq('session_id', sessionId);

      if (error) {
        logger.error('Error fetching voice mappings:', error);
        return [];
      }

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
      logger.error('Error getting session mappings:', error);
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
      const now = new Date().toISOString();
      const { error } = await supabase.from('character_voice_mappings').insert({
        session_id: sessionId,
        character_name: characterName,
        voice_category: voiceCategory,
        voice_id: voiceId,
        appearance_count: initialCount,
        first_appearance: now,
        last_used: now,
        metadata: {},
      });

      if (error) throw error;

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
      const now = new Date().toISOString();

      const { error } = await supabase
        .from('character_voice_mappings')
        .update({
          appearance_count: newCount,
          last_used: now,
          updated_at: now,
        })
        .eq('id', mappingId);

      if (error) throw error;

      logger.debug(`📊 Updated usage for mapping: ${mappingId} (count: ${newCount})`);
    } catch (error) {
      logger.error('Error updating character usage:', error);
    }
  }
}
