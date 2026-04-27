/**
 * Voice Consistency Service
 *
 * Manages persistent character-to-voice mappings across game sessions.
 * Ensures characters maintain the same voice throughout the campaign.
 * Provides context to AI for voice category assignments.
 *
 * Dependencies:
 * - Supabase client (src/integrations/supabase/client.ts)
 * - Voice Mapper Service (src/services/voice-mapper.ts)
 *
 * @author AI Dungeon Master Team
 */

import { VoiceMapper } from './voice-mapper';
import { voiceProfileService, type VoiceProfile } from './voice-profile-service';

import type { VoiceConfig } from './voice/voice-types';

import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';


export { type VoiceProfile };

export interface CharacterVoiceMapping {
  id: string;
  session_id: string | null;
  character_name: string;
  voice_id: string | null;
  voice_category: string;
  appearance_count: number | null;
  first_appearance: string | null;
  last_used: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface VoiceAssignment {
  character: string;
  voiceCategory: string;
  voiceConfig: VoiceConfig;
  isNewCharacter: boolean;
}

export interface SessionVoiceContext {
  knownCharacters: Record<
    string,
    {
      voiceCategory: string;
      appearances: number;
      lastUsed: Date;
    }
  >;
  availableVoiceCategories: string[];
}

export class VoiceConsistencyService {
  private sessionCache = new Map<string, Map<string, CharacterVoiceMapping>>();

  /**
   * Get voice context for a session to include in AI prompts
   */
  async getSessionVoiceContext(sessionId: string): Promise<SessionVoiceContext> {
    logger.info('🎭 Getting voice context for session:', sessionId);

    try {
      const mappings = await this.getSessionMappings(sessionId);

      const knownCharacters: SessionVoiceContext['knownCharacters'] =
        {} as SessionVoiceContext['knownCharacters'];
      mappings.forEach((mapping) => {
        knownCharacters[mapping.characterName] = {
          voiceCategory: mapping.voiceCategory,
          appearances: mapping.appearanceCount,
          lastUsed: mapping.lastUsed,
        };
      });

      // Get available voice categories from VoiceMapper
      const allVoices = VoiceMapper.getAllVoices();
      const availableVoiceCategories = Object.keys(allVoices).filter((key) => key !== 'default');

      logger.debug('📋 Voice context:', {
        knownCharacters: Object.keys(knownCharacters),
        availableCategories: availableVoiceCategories.length,
      });

      return {
        knownCharacters,
        availableVoiceCategories,
      };
    } catch (error) {
      logger.error('Error getting session voice context:', error);

      // Return minimal context on error
      const allVoices = VoiceMapper.getAllVoices();
      return {
        knownCharacters: {},
        availableVoiceCategories: Object.keys(allVoices).filter((key) => key !== 'default'),
      };
    }
  }

  /**
   * Process voice assignments from AI response segments
   */
  async processVoiceAssignments(
    sessionId: string,
    segments: Array<{
      type: string;
      text: string;
      character?: string;
      voice_category?: string;
    }>,
  ): Promise<VoiceAssignment[]> {
    logger.info('🎪 Processing voice assignments for', segments.length, 'segments');

    const assignments: VoiceAssignment[] = [];
    const existingMappings = await this.getSessionMappings(sessionId);
    const mappingLookup = new Map(existingMappings.map((m) => [m.characterName, m]));

    for (const segment of segments) {
      if (!segment.character) {
        // Narration - use narrator voice
        assignments.push({
          character: 'narrator',
          voiceCategory: 'narrator',
          voiceConfig: VoiceMapper.getNarratorVoice(),
          isNewCharacter: false,
        });
        continue;
      }

      const cleanCharacter = this.normalizeCharacterName(segment.character);
      const existingMapping = mappingLookup.get(cleanCharacter);

      if (existingMapping) {
        // Use existing voice assignment
        logger.debug(
          `♻️ Using existing voice for "${cleanCharacter}": ${existingMapping.voiceCategory}`,
        );

        assignments.push({
          character: cleanCharacter,
          voiceCategory: existingMapping.voiceCategory,
          voiceConfig:
            VoiceMapper.getAllVoices()[existingMapping.voiceCategory] ||
            VoiceMapper.getAllVoices().default,
          isNewCharacter: false,
        });

        // Update usage
        await this.updateCharacterUsage(existingMapping.id);
      } else {
        // New character - use AI's voice category assignment or fallback
        const voiceCategory = segment.voice_category || this.inferVoiceCategory(cleanCharacter);
        const voiceConfig =
          VoiceMapper.getAllVoices()[voiceCategory] || VoiceMapper.getAllVoices().default;

        logger.info(`✨ New character "${cleanCharacter}" assigned voice: ${voiceCategory}`);

        assignments.push({
          character: cleanCharacter,
          voiceCategory,
          voiceConfig,
          isNewCharacter: true,
        });

        // Save new mapping
        await this.saveCharacterVoiceMapping(
          sessionId,
          cleanCharacter,
          voiceCategory,
          voiceConfig.id,
        );

        // Cache the new mapping
        mappingLookup.set(cleanCharacter, {
          id: '', // Will be set by database
          sessionId,
          characterName: cleanCharacter,
          voiceCategory,
          voiceId: voiceConfig.id,
          firstAppearance: new Date(),
          lastUsed: new Date(),
          appearanceCount: 1,
          metadata: {},
        });
      }
    }

    logger.info(
      '🎯 Voice assignments completed:',
      assignments.map((a) => `${a.character}(${a.voiceCategory})`).join(', '),
    );

    return assignments;
  }

  /**
   * Get voice mappings for a session
   * Retrieves all character voice mappings for this specific session
   */
  private async getSessionMappings(sessionId: string): Promise<
    Array<{
      id: string;
      characterName: string;
      voiceCategory: string;
      lastUsed: Date;
      appearanceCount: number;
    }>
  > {
    try {
      // Query voice mappings directly by session_id
      const { data, error } = await supabase
        .from('character_voice_mappings')
        .select('*')
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
  private async saveCharacterVoiceMapping(
    sessionId: string,
    characterName: string,
    voiceCategory: string,
    voiceId: string,
  ): Promise<void> {
    try {
      const now = new Date().toISOString();
      const { error } = await supabase.from('character_voice_mappings').insert({
        session_id: sessionId,
        character_name: characterName,
        voice_category: voiceCategory,
        voice_id: voiceId,
        appearance_count: 1,
        first_appearance: now,
        last_used: now,
        metadata: {},
      });

      if (error) throw error;

      logger.info(`💾 Saved voice mapping: ${characterName} -> ${voiceCategory} (${voiceId})`);
    } catch (error) {
      logger.error('Error saving character voice mapping:', error);
    }
  }

  /**
   * Update character usage statistics
   */
  private async updateCharacterUsage(mappingId: string): Promise<void> {
    try {
      // First, get the current appearance count
      const { data: mapping, error: fetchError } = await supabase
        .from('character_voice_mappings')
        .select('appearance_count')
        .eq('id', mappingId)
        .single();

      if (fetchError) throw fetchError;

      const currentCount = mapping?.appearance_count || 0;

      // Update with incremented count and new timestamp
      const { error } = await supabase
        .from('character_voice_mappings')
        .update({
          appearance_count: currentCount + 1,
          last_used: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', mappingId);

      if (error) throw error;

      logger.debug(
        `📊 Updated character usage for mapping: ${mappingId} (count: ${currentCount + 1})`,
      );
    } catch (error) {
      logger.error('Error updating character usage:', error);
    }
  }

  /**
   * Normalize character names for consistency
   */
  private normalizeCharacterName(name: string): string {
    return name
      .trim()
      .toLowerCase()
      .replace(/^(the|a|an)\s+/i, '') // Remove articles
      .replace(/[^\w\s'-]/g, '') // Keep only letters, spaces, apostrophes, hyphens
      .replace(/\s+/g, ' ') // Normalize spaces
      .trim();
  }

  /**
   * Infer voice category from character name when AI doesn't provide one
   */
  private inferVoiceCategory(characterName: string): string {
    const name = characterName.toLowerCase();

    // Check for character type keywords
    const keywords = {
      elder: ['wizard', 'sage', 'old', 'ancient', 'elder', 'master', 'thorne'],
      villain_male: ['villain', 'dark', 'evil', 'lord', 'demon', 'shadow'],
      villain_female: ['witch', 'sorceress', 'dark lady', 'empress'],
      guard: ['guard', 'soldier', 'captain', 'knight', 'watchman'],
      merchant: ['merchant', 'trader', 'shopkeeper', 'vendor'],
      child: ['child', 'kid', 'young', 'boy', 'girl'],
      monster: ['dragon', 'beast', 'creature', 'monster', 'giant'],
      goblin: ['goblin', 'imp', 'sprite', 'kobold'],
    };

    for (const [category, keywordList] of Object.entries(keywords)) {
      if (keywordList.some((keyword) => name.includes(keyword))) {
        return category;
      }
    }

    // Default fallbacks
    if (name.includes('female') || name.includes('woman') || name.includes('lady')) {
      return 'hero_female';
    }

    // Default to male hero voice
    return 'hero_male';
  }

  /**
   * Clear cache for a session (useful for debugging)
   */
  clearSessionCache(sessionId: string): void {
    this.sessionCache.delete(sessionId);
    logger.info(`🗑️ Cleared voice cache for session: ${sessionId}`);
  }

  /**
   * Get character mapping statistics for debugging
   */
  async getSessionStats(sessionId: string): Promise<{
    totalCharacters: number;
    voiceCategoryCounts: Record<string, number>;
    recentCharacters: string[];
  }> {
    const mappings = await this.getSessionMappings(sessionId);

    const voiceCategoryCounts: Record<string, number> = {};
    mappings.forEach((mapping) => {
      voiceCategoryCounts[mapping.voiceCategory] =
        (voiceCategoryCounts[mapping.voiceCategory] || 0) + 1;
    });

    const recentCharacters = mappings
      .sort((a, b) => b.lastUsed.getTime() - a.lastUsed.getTime())
      .slice(0, 5)
      .map((m) => `${m.characterName}(${m.voiceCategory})`);

    return {
      totalCharacters: mappings.length,
      voiceCategoryCounts,
      recentCharacters,
    };
  }

  /**
   * Retrieves the voice profile for a character (Delegated)
   */
  async getVoiceProfile(characterId: string): Promise<VoiceProfile | null> {
    return voiceProfileService.getVoiceProfile(characterId);
  }

  /**
   * Creates or updates a character's voice profile (Delegated)
   */
  async upsertVoiceProfile(
    characterId: string,
    profile: Partial<Omit<VoiceProfile, 'id' | 'character_id' | 'created_at' | 'updated_at'>>,
  ): Promise<VoiceProfile | null> {
    return voiceProfileService.upsertVoiceProfile(characterId, profile);
  }

  /**
   * Analyzes dialogue to extract voice characteristics using AI (Delegated)
   */
  async analyzeDialogue(dialogue: string[]): Promise<Partial<VoiceProfile>> {
    return voiceProfileService.analyzeDialogue(dialogue);
  }
}

// Singleton instance
export const voiceConsistencyService = new VoiceConsistencyService();
