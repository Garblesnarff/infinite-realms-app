/**
 * Voice Director Service
 *
 * Single source of truth for voice synthesis management.
 * Replaces complex parsing chain with simple, direct approach.
 *
 * Key principles:
 * - AI segments are trusted - no re-parsing needed
 * - Character names map to consistent voices via pools
 * - Progressive audio generation and playback
 * - Robust fallbacks at every step
 *
 * @author AI Dungeon Master Team
 */

import { VoiceAudioService } from './voice/voice-audio-service';
import { getVoiceCategoryKey } from './voice/voice-classification';
import { VoiceDialogueParser } from './voice/voice-dialogue-parser';
import { type VoicePool } from './voice/voice-pools';
import { cleanSegmentText } from './voice/voice-utils';
import {
  type AISegment,
  type VoiceConfig,
  type VoiceSegment,
  VOICE_CATEGORY_VALUES,
  assignVoice,
  clearCharacterVoiceMappings as clearMappings,
  getCharacterVoiceMappings as getMappings,
} from './voice-routing';

import logger from '@/lib/logger';
import { stripAssetTags } from '@/lib/utils';
import { stripEngineGeneratedLinesFromSegments } from '@/utils/engine-lines';

export type { VoiceSegment, VoicePool, VoiceConfig, AISegment };

export class VoiceDirector {
  /**
   * Convert AI segments to voice-ready segments
   * This is the main entry point - replaces the complex parsing chain
   */
  static processAISegments(aiSegments: AISegment[], _sessionId?: string): VoiceSegment[] {
    const narratableSegments = stripEngineGeneratedLinesFromSegments(aiSegments).flatMap(
      (segment) => {
        const text = stripAssetTags(segment.text);
        return text ? [{ ...segment, text }] : [];
      },
    );
    logger.info('🎭 VoiceDirector: Processing', narratableSegments.length, 'AI segments');

    const voiceSegments: VoiceSegment[] = [];

    for (let i = 0; i < narratableSegments.length; i++) {
      const segment = narratableSegments[i];

      try {
        // Clean and validate text
        const cleanText = cleanSegmentText(segment.text);
        if (!cleanText) {
          logger.warn(`⚠️ Skipping empty segment ${i + 1}`);
          continue;
        }

        // Assign voice based on type and character
        const voiceConfig = assignVoice(segment);

        const voiceSegment: VoiceSegment = {
          id: `segment_${Date.now()}_${i}`,
          type: segment.type,
          text: cleanText,
          character: segment.character || (segment.type === 'dm' ? 'DM' : 'Unknown'),
          voiceId: voiceConfig.id,
          voiceName: voiceConfig.name,
          voiceCategory: getVoiceCategoryKey(voiceConfig),
          voiceSettings: voiceConfig.settings,
          isGenerating: false,
          isPlaying: false,
        };

        voiceSegments.push(voiceSegment);

        logger.info(
          `✅ Segment ${i + 1}: "${voiceSegment.character}" -> ${voiceSegment.voiceName} [${voiceSegment.voiceId}] (${cleanText.substring(0, 50)}...)`,
        );
      } catch (error) {
        logger.error(`❌ Error processing segment ${i + 1}:`, error);
        // Continue processing other segments
      }
    }

    logger.info(`🎵 VoiceDirector: Created ${voiceSegments.length} voice segments`);
    return voiceSegments;
  }

  /**
   * Enhanced: Process plain text by detecting dialogue and attributing voices
   * Parses quoted speech with attribution to assign character voices
   */
  static processPlainText(text: string): VoiceSegment[] {
    return VoiceDialogueParser.processPlainText(text);
  }

  /**
   * Generate audio for a single segment with caching - Delegated to VoiceAudioService
   */
  static async generateAudio(segment: VoiceSegment, signal?: AbortSignal): Promise<VoiceSegment> {
    return VoiceAudioService.generateAudio(segment, signal);
  }

  /**
   * Get all available voice categories for AI prompting
   */
  static getAvailableVoiceCategories(): string[] {
    return [...VOICE_CATEGORY_VALUES];
  }

  /**
   * Clear audio cache manually - Delegated to VoiceAudioService
   */
  static clearAudioCache(): void {
    VoiceAudioService.clearAudioCache();
  }

  /**
   * Get audio cache statistics - Delegated to VoiceAudioService
   */
  static getAudioCacheStats(): { size: number; keys: string[] } {
    return VoiceAudioService.getAudioCacheStats();
  }

  /**
   * Get current character-to-voice mappings
   */
  static getCharacterVoiceMappings(): Record<string, string> {
    return getMappings();
  }

  /**
   * Clear character voice mappings (for debugging)
   */
  static clearCharacterVoiceMappings(): void {
    logger.info('🗑️ VoiceDirector: Clearing all character voice mappings');
    clearMappings();
  }

  /**
   * Validate segments before processing
   */
  static validateAISegments(segments: Array<Partial<AISegment>>): AISegment[] {
    const validSegments: AISegment[] = [];

    segments.forEach((segment, index) => {
      if (!segment?.text || !segment.text.trim()) {
        logger.warn(`⚠️ Skipping empty segment ${index + 1}`);
        return;
      }

      const segType = segment.type === 'dm' || segment.type === 'character' ? segment.type : 'dm';
      if (segType === 'dm' && segment.type !== 'dm') {
        logger.warn(`⚠️ Converting segment ${index + 1} type "${String(segment.type)}" to "dm"`);
      }

      validSegments.push({
        type: segType,
        text: segment.text,
        character: segment.character || undefined,
        voice_category: segment.voice_category || undefined,
      });
    });

    return validSegments;
  }
}
