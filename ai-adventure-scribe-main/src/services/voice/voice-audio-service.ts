import { type VoiceSegment, ELEVENLABS_MODEL } from '../voice-routing';

import logger from '@/lib/logger';
import { getAuthHeaders } from '@/services/auth/TokenService';

/**
 * Voice Audio Service
 *
 * Extracted from VoiceDirector.
 * Handles audio generation via ElevenLabs API and caching of audio blobs.
 */
export class VoiceAudioService {
  // Audio cache for generated segments
  private static audioCache: Map<string, { audioBlob: Blob; timestamp: number }> = new Map();
  private static readonly CACHE_MAX_SIZE = 50;
  private static readonly CACHE_MAX_AGE = 1000 * 60 * 60; // 1 hour

  /**
   * Generate cache key for audio segments
   */
  private static generateCacheKey(voiceId: string, text: string): string {
    // Simple hash function for text
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return `${voiceId}_${Math.abs(hash)}`;
  }

  /**
   * Clean expired cache entries
   */
  private static cleanExpiredCache(): void {
    const now = Date.now();
    for (const [key, value] of VoiceAudioService.audioCache.entries()) {
      if (now - value.timestamp > VoiceAudioService.CACHE_MAX_AGE) {
        VoiceAudioService.audioCache.delete(key);
      }
    }
  }

  /**
   * Manage cache size
   */
  private static manageCacheSize(): void {
    if (VoiceAudioService.audioCache.size > VoiceAudioService.CACHE_MAX_SIZE) {
      // Remove oldest entries
      const entries = Array.from(VoiceAudioService.audioCache.entries()).sort(
        (a, b) => a[1].timestamp - b[1].timestamp,
      );

      const toRemove = entries.slice(0, 10); // Remove 10 oldest
      toRemove.forEach(([key]) => {
        VoiceAudioService.audioCache.delete(key);
      });

      logger.info(`🧹 Cleaned up ${toRemove.length} old audio cache entries`);
    }
  }

  /**
   * Generate audio for a single segment with caching
   */
  static async generateAudio(segment: VoiceSegment): Promise<VoiceSegment> {
    const cacheKey = VoiceAudioService.generateCacheKey(segment.voiceId, segment.text);

    // Check cache first
    VoiceAudioService.cleanExpiredCache();
    const cachedAudio = VoiceAudioService.audioCache.get(cacheKey);

    if (cachedAudio) {
      logger.debug(
        `🔄 Using cached audio for ${segment.character}: "${segment.text.substring(0, 50)}..."`,
      );
      const audioUrl = URL.createObjectURL(cachedAudio.audioBlob);
      return {
        ...segment,
        audioBlob: cachedAudio.audioBlob,
        audioUrl,
        isGenerating: false,
      };
    }

    logger.info(
      `🎵 Generating NEW audio for ${segment.character} with voice ${segment.voiceId}: "${segment.text.substring(0, 50)}..."`,
    );

    try {
      const apiBase = import.meta.env.VITE_API_URL || '';
      const response = await fetch(
        `${apiBase}/v1/ai-proxy/voice/${encodeURIComponent(segment.voiceId)}`,
        {
          method: 'POST',
          headers: {
            Accept: 'audio/mpeg',
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
          },
          body: JSON.stringify({
            text: segment.text,
            model_id: ELEVENLABS_MODEL,
            voice_settings: segment.voiceSettings,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`ElevenLabs API error: ${response.status} ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const audioBlob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
      const audioUrl = URL.createObjectURL(audioBlob);

      // Cache the generated audio
      VoiceAudioService.audioCache.set(cacheKey, {
        audioBlob,
        timestamp: Date.now(),
      });

      // Manage cache size
      VoiceAudioService.manageCacheSize();

      logger.debug(`💾 Cached audio for key: ${cacheKey}`);

      return {
        ...segment,
        audioBlob,
        audioUrl,
        isGenerating: false,
      };
    } catch (error) {
      logger.error(`❌ Failed to generate audio for ${segment.character}:`, error);
      return {
        ...segment,
        error: error instanceof Error ? error.message : 'Audio generation failed',
        isGenerating: false,
      };
    }
  }

  /**
   * Clear audio cache manually
   */
  static clearAudioCache(): void {
    const cacheSize = VoiceAudioService.audioCache.size;
    VoiceAudioService.audioCache.clear();
    logger.info(`🧹 Cleared ${cacheSize} cached audio segments`);
  }

  /**
   * Get audio cache statistics
   */
  static getAudioCacheStats(): { size: number; keys: string[] } {
    const stats = {
      size: VoiceAudioService.audioCache.size,
      keys: Array.from(VoiceAudioService.audioCache.keys()),
    };
    logger.debug('📊 Audio Cache Stats:', stats);
    return stats;
  }
}
