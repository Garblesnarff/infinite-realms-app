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
import {
  VOICE_CATEGORY_VALUES,
  getCanonicalVoiceCategory,
  isUnknownSpeaker,
  setCharacterVoiceMapping,
} from './voice-routing';

import type { VoiceConfig } from './voice/voice-types';

import logger from '@/lib/logger';
import { stripEngineGeneratedLinesFromSegments } from '@/utils/engine-lines';

const LEGACY_NARRATOR_VOICE_ID = 'bIHbv24MWmeRgasZH58o';

type ResolvedVoice = {
  voiceCategory: string;
  voiceConfig: VoiceConfig;
  isCacheable: boolean;
};

function resolveVoiceCategory(category: string): ResolvedVoice {
  const canonicalCategory = getCanonicalVoiceCategory(category);
  const voiceConfig = VoiceMapper.getVoiceForCategory(category);

  if (!canonicalCategory) {
    return {
      voiceCategory: 'narrator',
      voiceConfig,
      isCacheable: false,
    };
  }

  return {
    voiceCategory: canonicalCategory,
    voiceConfig,
    isCacheable: true,
  };
}

function resolvePersistedVoiceConfig(mapping: {
  voiceCategory: string;
  voiceId: string | null;
}): ResolvedVoice {
  const resolved = resolveVoiceCategory(mapping.voiceCategory);
  if (!resolved.isCacheable) {
    return resolved;
  }

  const { voiceConfig } = resolved;
  const persistedVoiceId = mapping.voiceId?.trim();

  // Older assignments stored the narrator ID when an AI label was not found
  // (notably "gruff"). Do not let that stale fallback overwrite a now-valid
  // category mapping; retain non-fallback custom IDs for canonical categories.
  if (
    !persistedVoiceId ||
    persistedVoiceId === LEGACY_NARRATOR_VOICE_ID ||
    persistedVoiceId === VoiceMapper.getNarratorVoice().id
  ) {
    return resolved;
  }

  return { ...resolved, voiceConfig: { ...voiceConfig, id: persistedVoiceId } };
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

      const availableVoiceCategories = [...VOICE_CATEGORY_VALUES];
      const knownCharacters: SessionVoiceContext['knownCharacters'] = {};
      mappings.forEach((mapping) => {
        const voiceCategory = getCanonicalVoiceCategory(mapping.voiceCategory);
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
    logger.info('🎪 Processing voice assignments for', cleanSegments.length, 'segments');

    const assignments: VoiceAssignment[] = [];
    const existingMappings = await VoiceConsistencyRepository.getSessionMappings(sessionId);
    if (signal?.aborted) return [];
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
      if (signal?.aborted) return assignments;
      if (!segment.character || isUnknownSpeaker(segment.character)) {
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
        const resolved = resolvePersistedVoiceConfig(existingMapping);
        if (resolved.isCacheable) {
          setCharacterVoiceMapping(cleanCharacter, resolved.voiceConfig);
          updatesNeeded.set(existingMapping.id, (updatesNeeded.get(existingMapping.id) || 0) + 1);
          assignments.push({
            character: cleanCharacter,
            voiceCategory: resolved.voiceCategory,
            voiceConfig: resolved.voiceConfig,
            isNewCharacter: false,
          });
          continue;
        }
        mappingLookup.delete(cleanCharacter);
      }

      const pending = pendingAssignments.get(cleanCharacter);
      const resolved = pending
        ? { ...pending, isCacheable: true }
        : resolveVoiceCategory(segment.voice_category || inferVoiceCategory(cleanCharacter));

      if (resolved.isCacheable) {
        pendingAssignments.set(cleanCharacter, {
          voiceCategory: resolved.voiceCategory,
          voiceConfig: resolved.voiceConfig,
        });
        setCharacterVoiceMapping(cleanCharacter, resolved.voiceConfig);
      }

      assignments.push({
        character: cleanCharacter,
        voiceCategory: resolved.voiceCategory,
        voiceConfig: resolved.voiceConfig,
        isNewCharacter: true,
      });

      if (resolved.isCacheable) {
        const pendingInsert = insertsNeeded.get(cleanCharacter);
        if (pendingInsert) {
          pendingInsert.count++;
        } else {
          insertsNeeded.set(cleanCharacter, {
            characterName: cleanCharacter,
            voiceCategory: resolved.voiceCategory,
            voiceId: resolved.voiceConfig.id,
            count: 1,
          });
        }
      }
    }

    // ⚡ Bolt: Execute aggregated database operations in parallel to minimize total latency.
    const tasks: Promise<unknown>[] = [];

    // Aggregated updates
    for (const [id, increment] of updatesNeeded.entries()) {
      if (signal?.aborted) return assignments;
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
      if (signal?.aborted) return assignments;
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

    if (signal?.aborted) return assignments;

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
