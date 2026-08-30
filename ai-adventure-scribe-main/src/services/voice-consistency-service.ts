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

import { VoiceConsistencyRepository } from './voice/voice-consistency-repository';
import { inferVoiceCategory, normalizeCharacterName } from './voice/voice-utils';
import { VoiceMapper } from './voice-mapper';
import { voiceProfileService, type VoiceProfile } from './voice-profile-service';
import { setCharacterVoiceMapping } from './voice-routing';

import type { VoiceConfig } from './voice/voice-types';

import logger from '@/lib/logger';
import { stripEngineGeneratedLinesFromSegments } from '@/utils/engine-lines';

const LEGACY_NARRATOR_VOICE_ID = 'bIHbv24MWmeRgasZH58o';

function resolvePersistedVoiceConfig(mapping: {
  voiceCategory: string;
  voiceId: string | null;
}): VoiceConfig {
  const voiceConfig = VoiceMapper.getVoiceForCategory(mapping.voiceCategory);
  const persistedVoiceId = mapping.voiceId?.trim();

  // Older assignments stored the narrator ID when an AI label was not found
  // (notably "gruff"). Do not let that stale fallback overwrite a now-valid
  // category mapping; retain non-fallback custom IDs for canonical categories.
  if (
    !persistedVoiceId ||
    persistedVoiceId === LEGACY_NARRATOR_VOICE_ID ||
    persistedVoiceId === VoiceMapper.getNarratorVoice().id
  ) {
    return voiceConfig;
  }

  return { ...voiceConfig, id: persistedVoiceId };
}

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
      const mappings = await VoiceConsistencyRepository.getSessionMappings(sessionId);

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
    const cleanSegments = stripEngineGeneratedLinesFromSegments(segments);
    logger.info('🎪 Processing voice assignments for', cleanSegments.length, 'segments');

    const assignments: VoiceAssignment[] = [];
    const existingMappings = await VoiceConsistencyRepository.getSessionMappings(sessionId);
    const mappingLookup = new Map(existingMappings.map((m) => [m.characterName, m]));

    // ⚡ Bolt: Track appearance counts for aggregation to avoid redundant sequential updates.
    const updatesNeeded = new Map<string, number>(); // mappingId -> count
    const insertsNeeded = new Map<
      string,
      { characterName: string; voiceCategory: string; voiceId: string; count: number }
    >();
    const pendingAssignments = new Map<
      string,
      { voiceCategory: string; voiceConfig: VoiceConfig }
    >();

    for (const segment of cleanSegments) {
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

      const cleanCharacter = normalizeCharacterName(segment.character);
      const existingMapping = mappingLookup.get(cleanCharacter);

      if (existingMapping) {
        // Use existing voice assignment
        const voiceConfig = resolvePersistedVoiceConfig(existingMapping);
        setCharacterVoiceMapping(cleanCharacter, voiceConfig);
        assignments.push({
          character: cleanCharacter,
          voiceCategory: existingMapping.voiceCategory,
          voiceConfig,
          isNewCharacter: false,
        });

        // ⚡ Bolt: Aggregate increments for existing characters.
        updatesNeeded.set(existingMapping.id, (updatesNeeded.get(existingMapping.id) || 0) + 1);
      } else {
        // New character - use AI's voice category assignment or fallback
        const pending = pendingAssignments.get(cleanCharacter);
        const voiceCategory =
          pending?.voiceCategory || segment.voice_category || inferVoiceCategory(cleanCharacter);
        const voiceConfig = pending?.voiceConfig || VoiceMapper.getVoiceForCategory(voiceCategory);

        pendingAssignments.set(cleanCharacter, { voiceCategory, voiceConfig });
        setCharacterVoiceMapping(cleanCharacter, voiceConfig);

        assignments.push({
          character: cleanCharacter,
          voiceCategory,
          voiceConfig,
          isNewCharacter: true,
        });

        // ⚡ Bolt: Aggregate increments for new characters in this response.
        const pendingInsert = insertsNeeded.get(cleanCharacter);
        if (pendingInsert) {
          pendingInsert.count++;
        } else {
          insertsNeeded.set(cleanCharacter, {
            characterName: cleanCharacter,
            voiceCategory,
            voiceId: voiceConfig.id,
            count: 1,
          });
        }
      }
    }

    // ⚡ Bolt: Execute aggregated database operations in parallel to minimize total latency.
    const tasks: Promise<unknown>[] = [];

    // Aggregated updates
    for (const [id, increment] of updatesNeeded.entries()) {
      // ⚡ Bolt: Use the cached appearanceCount from existingMappings to calculate the new count,
      // avoiding a redundant SELECT query per unique character.
      const mapping = existingMappings.find((m) => m.id === id);
      if (mapping) {
        const newCount = mapping.appearanceCount + increment;
        tasks.push(VoiceConsistencyRepository.updateCharacterUsage(id, newCount));
      }
    }

    // Aggregated inserts
    for (const data of insertsNeeded.values()) {
      tasks.push(
        VoiceConsistencyRepository.saveCharacterVoiceMapping(
          sessionId,
          data.characterName,
          data.voiceCategory,
          data.voiceId,
          data.count,
        ),
      );
    }

    if (tasks.length > 0) {
      await Promise.all(tasks);
    }

    logger.info(
      '🎯 Voice assignments completed:',
      assignments.map((a) => `${a.character}(${a.voiceCategory})`).join(', '),
    );

    return assignments;
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
    const mappings = await VoiceConsistencyRepository.getSessionMappings(sessionId);

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
