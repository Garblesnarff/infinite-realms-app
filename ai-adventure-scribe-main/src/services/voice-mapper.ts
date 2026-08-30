/**
 * Voice Mapping Service
 *
 * Maps character types and names to specific ElevenLabs voice IDs and settings.
 * Uses the most cost-effective Flash v2.5 model for all voices.
 *
 * @author AI Dungeon Master Team
 */

import { getCanonicalVoiceCategory, getVoiceConfigByCategory } from './voice/voice-classification';
import { VOICE_CONFIGS, CHARACTER_KEYWORDS } from './voice/voice-constants';

import type { VoiceConfig } from './voice/voice-types';

import logger from '@/lib/logger';

export type { VoiceConfig };

export class VoiceMapper {
  /**
   * Get voice configuration for a character
   */
  static getVoiceForCharacter(character: string): VoiceConfig {
    logger.debug(`🔍 VoiceMapper.getVoiceForCharacter called with: "${character}"`);

    if (!character || character === 'unknown') {
      logger.info('↪️ Using default voice (no character name)');
      return VOICE_CONFIGS.default;
    }

    const cleanCharacter = character.toLowerCase().trim();
    logger.debug(`🧹 Cleaned character name: "${cleanCharacter}"`);

    // First, try to find exact match in saved character mappings
    const savedVoice = this.getSavedCharacterVoice(cleanCharacter);
    if (savedVoice) {
      logger.info(`💾 Found saved voice mapping: ${savedVoice.name} (${savedVoice.id})`);
      return savedVoice;
    }

    // Then, try keyword matching
    for (const [voiceType, keywords] of Object.entries(CHARACTER_KEYWORDS)) {
      for (const keyword of keywords) {
        if (cleanCharacter.includes(keyword)) {
          const voiceConfig = VOICE_CONFIGS[voiceType];
          if (voiceConfig) {
            logger.info(
              `🎯 Keyword match found: "${keyword}" -> ${voiceType} -> ${voiceConfig.name} (${voiceConfig.id})`,
            );
            // Save this mapping for future use
            this.saveCharacterVoice(cleanCharacter, voiceType);
            return voiceConfig;
          }
        }
      }
    }

    // Finally, use smart classification for unknown characters
    const classifiedType = this.classifyCharacter(cleanCharacter);
    const voiceConfig = VOICE_CONFIGS[classifiedType] || VOICE_CONFIGS.default;
    logger.info(
      `🤖 Smart classification: "${cleanCharacter}" -> ${classifiedType} -> ${voiceConfig.name} (${voiceConfig.id})`,
    );

    // Save this mapping
    this.saveCharacterVoice(cleanCharacter, classifiedType);

    return voiceConfig;
  }

  /**
   * Get voice configuration for narration
   */
  static getNarratorVoice(): VoiceConfig {
    return this.getVoiceForCategory('narrator');
  }

  /**
   * Resolve an AI category label to a configured voice.
   * This is the only category-to-voice lookup used by the consistency path.
   */
  static getVoiceForCategory(category: string): VoiceConfig {
    return getVoiceConfigByCategory(category);
  }

  /**
   * Get all available voice configurations
   */
  static getAllVoices(): Record<string, VoiceConfig> {
    return { ...VOICE_CONFIGS };
  }

  /**
   * Classify unknown character using simple heuristics
   */
  private static classifyCharacter(character: string): string {
    // Simple classification based on name patterns
    if (character.includes('sir') || character.includes('lord') || character.includes('lady')) {
      return 'hero_male';
    }

    if (character.includes('captain') || character.includes('commander')) {
      return 'guard';
    }

    if (character.includes('master') || character.includes('wise')) {
      return 'elder';
    }

    // Default to generic NPC voice
    return 'default';
  }

  /**
   * Save character to voice mapping to localStorage
   */
  private static saveCharacterVoice(character: string, voiceType: string): void {
    try {
      const saved = JSON.parse(localStorage.getItem('character-voice-mappings') || '{}');
      saved[character] = voiceType;
      localStorage.setItem('character-voice-mappings', JSON.stringify(saved));
    } catch (error) {
      logger.warn('Failed to save character voice mapping:', error);
    }
  }

  /**
   * Get saved character to voice mapping from localStorage
   */
  private static getSavedCharacterVoice(character: string): VoiceConfig | null {
    try {
      const saved = JSON.parse(localStorage.getItem('character-voice-mappings') || '{}');
      const voiceType = saved[character];
      return voiceType && getCanonicalVoiceCategory(voiceType)
        ? this.getVoiceForCategory(voiceType)
        : null;
    } catch (error) {
      logger.warn('Failed to load character voice mapping:', error);
      return null;
    }
  }

  /**
   * Update voice configuration for a specific character
   */
  static updateCharacterVoice(character: string, voiceType: string): boolean {
    const canonicalVoiceType = getCanonicalVoiceCategory(voiceType);
    if (!canonicalVoiceType) {
      return false;
    }

    this.saveCharacterVoice(character.toLowerCase().trim(), canonicalVoiceType);
    return true;
  }

  /**
   * Get all saved character mappings
   */
  static getSavedMappings(): Record<string, string> {
    try {
      return JSON.parse(localStorage.getItem('character-voice-mappings') || '{}');
    } catch (error) {
      logger.warn('Failed to load character voice mappings:', error);
      return {};
    }
  }

  /**
   * Clear all saved character mappings
   */
  static clearSavedMappings(): void {
    try {
      logger.info('🗑️ Clearing all saved character voice mappings');
      localStorage.removeItem('character-voice-mappings');
    } catch (error) {
      logger.warn('Failed to clear character voice mappings:', error);
    }
  }

  /**
   * Debug and clear specific character mapping
   */
  static debugAndClearCharacter(character: string): void {
    try {
      const saved = JSON.parse(localStorage.getItem('character-voice-mappings') || '{}');
      const cleanCharacter = character.toLowerCase().trim();

      logger.info(`🔍 Debug character "${character}" (cleaned: "${cleanCharacter}"):`);
      logger.info('   Current saved mapping:', saved[cleanCharacter] || 'none');
      logger.info('   All saved mappings:', saved);

      if (saved[cleanCharacter]) {
        delete saved[cleanCharacter];
        localStorage.setItem('character-voice-mappings', JSON.stringify(saved));
        logger.info(`   ✅ Cleared mapping for "${cleanCharacter}"`);
      }

      // Test what voice would be assigned now
      const voiceConfig = this.getVoiceForCharacter(character);
      logger.info(`   🎭 Would now map to: ${voiceConfig.name} (${voiceConfig.id})`);
    } catch (error) {
      logger.warn('Failed to debug character mapping:', error);
    }
  }

  /**
   * Get voice categories for UI organization
   */
  static getVoiceCategories(): Record<string, VoiceConfig[]> {
    const categories: Record<string, VoiceConfig[]> = {};

    Object.values(VOICE_CONFIGS).forEach((voice) => {
      if (!categories[voice.category]) {
        categories[voice.category] = [];
      }
      if (!categories[voice.category].find((v) => v.id === voice.id)) {
        categories[voice.category].push(voice);
      }
    });

    return categories;
  }
}
