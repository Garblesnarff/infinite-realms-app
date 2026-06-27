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
import { detectVoiceCategoryFromNPCType } from './voice/voice-classification';
import { type VoicePool, VOICE_POOLS } from './voice/voice-pools';
import { cleanSegmentText } from './voice/voice-utils';
import { type AISegment, type VoiceConfig, type VoiceSegment, assignVoice, clearCharacterVoiceMappings as clearMappings, getCharacterVoiceMappings as getMappings } from './voice-routing';

import logger from '@/lib/logger';

export type { VoiceSegment, VoicePool, VoiceConfig, AISegment };

export class VoiceDirector {
  /**
   * Convert AI segments to voice-ready segments
   * This is the main entry point - replaces the complex parsing chain
   */
  static processAISegments(aiSegments: AISegment[], _sessionId?: string): VoiceSegment[] {
    logger.info('🎭 VoiceDirector: Processing', aiSegments.length, 'AI segments');

    const voiceSegments: VoiceSegment[] = [];

    for (let i = 0; i < aiSegments.length; i++) {
      const segment = aiSegments[i];

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
          voiceSettings: voiceConfig.settings,
          isGenerating: false,
          isPlaying: false,
        };

        voiceSegments.push(voiceSegment);

        logger.info(
          `✅ Segment ${i + 1}: "${voiceSegment.character}" -> ${voiceSegment.voiceName} (${cleanText.substring(0, 50)}...)`,
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
    logger.info('📝 VoiceDirector: Processing plain text with dialogue detection');

    const cleanText = cleanSegmentText(text);
    if (!cleanText) {
      return [];
    }

    // Parse text into dialogue and narration segments
    const parsedSegments = VoiceDirector.parseDialogueFromText(cleanText);

    if (parsedSegments.length === 0) {
      // No dialogue found, return as single DM segment
      const dmVoice = VOICE_POOLS.dm[0];
      return [
        {
          id: `fallback_${Date.now()}`,
          type: 'dm',
          text: cleanText,
          character: 'DM',
          voiceId: dmVoice.id,
          voiceName: dmVoice.name,
          voiceSettings: dmVoice.settings,
          isGenerating: false,
          isPlaying: false,
        },
      ];
    }

    // Convert parsed segments to voice segments
    return parsedSegments.map((segment, index) => {
      const voiceConfig = assignVoice(segment);
      return {
        id: `parsed_${Date.now()}_${index}`,
        type: segment.type,
        text: segment.text,
        character: segment.character || (segment.type === 'dm' ? 'DM' : 'Unknown'),
        voiceId: voiceConfig.id,
        voiceName: voiceConfig.name,
        voiceSettings: voiceConfig.settings,
        isGenerating: false,
        isPlaying: false,
      };
    });
  }

  /**
   * Parse dialogue from plain text
   * Returns an array of segments with type 'dm' (narration) or 'character' (dialogue)
   */
  private static parseDialogueFromText(text: string): AISegment[] {
    const segments: AISegment[] = [];

    // Regex to find quoted dialogue with optional attribution
    // Improved to handle smart quotes and apostrophes in character names
    const dialoguePattern =
      /(?:(?:(?:the\s+)?([\w']+(?:\s+[\w']+)?)\s+(?:says?|asks?|replies?|exclaims?|mutters?|whispers?|shouts?|growls?|warns?|declares?|announces?|speaks?|responds?),?\s*)?["“]([^"”]+)["”](?:\s*,?\s*(?:(?:says?|asks?|replies?|exclaims?|mutters?|whispers?|shouts?|growls?|warns?|declares?|announces?|speaks?|responds?)\s+)?(?:the\s+)?([\w']+(?:\s+[\w']+)?))?)/gi;

    let lastIndex = 0;
    let match;

    while ((match = dialoguePattern.exec(text)) !== null) {
      // Add narration before this dialogue (if any)
      const narrationBefore = text.slice(lastIndex, match.index).trim();
      if (narrationBefore) {
        segments.push({
          type: 'dm',
          text: narrationBefore,
        });
      }

      // Extract character name and dialogue
      const preCharacter = match[1]; // Character mentioned before quote
      const dialogue = match[2]; // The actual dialogue
      const postCharacter = match[3]; // Character mentioned after quote

      // Use whichever character name we found
      const characterName = (preCharacter || postCharacter || '').trim();
      const voiceCategory = detectVoiceCategoryFromNPCType(characterName);

      if (dialogue.trim()) {
        segments.push({
          type: 'character',
          text: dialogue.trim(),
          character: characterName || 'Unknown NPC',
          voice_category: voiceCategory,
        });
      }

      lastIndex = match.index + match[0].length;
    }

    // Add any remaining narration after the last dialogue
    const remainingText = text.slice(lastIndex).trim();
    if (remainingText) {
      segments.push({
        type: 'dm',
        text: remainingText,
      });
    }

    // If we found no dialogue, return empty to trigger fallback
    const hasDialogue = segments.some((s) => s.type === 'character');
    if (!hasDialogue) {
      return [];
    }

    logger.info(
      `🎭 Parsed ${segments.length} segments (${segments.filter((s) => s.type === 'character').length} dialogue)`,
    );
    return segments;
  }

  /**
   * Generate audio for a single segment with caching - Delegated to VoiceAudioService
   */
  static async generateAudio(segment: VoiceSegment, apiKey: string): Promise<VoiceSegment> {
    return VoiceAudioService.generateAudio(segment, apiKey);
  }

  /**
   * Get all available voice categories for AI prompting
   */
  static getAvailableVoiceCategories(): string[] {
    return [
      'narrator',
      'hero_male',
      'hero_female',
      'villain_male',
      'villain_female',
      'monster',
      'creature',
      'goblin',
      'merchant',
      'guard',
      'innkeeper',
      'elder',
      'child',
    ];
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
