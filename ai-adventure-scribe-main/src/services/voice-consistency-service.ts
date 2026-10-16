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
import { normalizeCharacterName } from './voice/voice-utils';
import { VoiceMapper } from './voice-mapper';
import { voiceProfileService, type VoiceProfile } from './voice-profile-service';
import {
  VOICE_CATEGORY_VALUES,
  getCanonicalVoiceCategory,
  setCharacterVoiceMapping,
} from './voice-routing';
import { irVoice } from '../../shared/npc-voices';

import type { VoiceConfig } from './voice/voice-types';

import logger from '@/lib/logger';
import { stripEngineGeneratedLinesFromSegments } from '@/utils/engine-lines';

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

      const availableVoiceCategories = [...VOICE_CATEGORY_VALUES];
      const knownCharacters: SessionVoiceContext['knownCharacters'] = {};
      mappings.forEach((mapping) => {
        const voiceCategory = getCanonicalVoiceCategory(mapping.voiceCategory ?? '');
        if (!voiceCategory) {
          logger.warn(
            `Ignoring unmapped persisted voice category "${mapping.voiceCategory}" for "${mapping.characterName}"`,
          );
          return;
        }
        knownCharacters[mapping.characterName] = {
          voiceCategory,
          appearances: mapping.appearanceCount,
          lastUsed: mapping.lastUsed,
        };
      });

      logger.debug('📋 Voice context:', {
        knownCharacters: Object.keys(knownCharacters),
        availableCategories: availableVoiceCategories.length,
      });

      return {
        knownCharacters,
        availableVoiceCategories,
      };
    } catch (error) {
      logger.error('Error getting session voice context:', {
        message: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : typeof error,
      });

      return {
        knownCharacters: {},
        availableVoiceCategories: [...VOICE_CATEGORY_VALUES],
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
    signal?: AbortSignal,
  ): Promise<VoiceAssignment[]> {
    if (signal?.aborted) return [];
    const cleanSegments = stripEngineGeneratedLinesFromSegments(segments);
    const cast = await VoiceConsistencyRepository.castSegments(sessionId, cleanSegments);
    if (signal?.aborted) return [];
    return cast
      .filter((segment) => !segment.voice_muted)
      .map((segment) => {
        const voiceCategory = getCanonicalVoiceCategory(segment.voice_category || '') || 'default';
        const voiceConfig = {
          ...VoiceMapper.getVoiceForCategory(voiceCategory),
          id: segment.voice_id || 'narrator',
        };
        const character = normalizeCharacterName(segment.character || 'narrator');
        if (segment.type === 'character' && irVoice(voiceConfig.id)) {
          setCharacterVoiceMapping(character, voiceConfig);
        }
        return { character, voiceCategory, voiceConfig, isNewCharacter: false };
      });
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
      voiceCategoryCounts[String(mapping.voiceCategory)] =
        (voiceCategoryCounts[String(mapping.voiceCategory)] || 0) + 1;
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
