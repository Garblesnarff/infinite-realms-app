import { type VoiceSegment } from '../voice-routing';
import { ElevenLabsProvider } from './elevenlabs-provider';
import { KokoroProvider, resolveStandardEngine } from './kokoro-provider';
import { getVoiceCategoryKey } from './voice-classification';
import { activatePremiumFallback, isStandardVoiceActive } from './voice-mode-store';
import {
  type VoiceProvider,
  type VoiceRef,
  VoiceQuotaError,
  VoiceUnavailableError,
} from './voice-provider';

import logger from '@/lib/logger';

/**
 * Voice Audio Service
 *
 * Extracted from VoiceDirector.
 * Single funnel for segment audio: picks a VoiceProvider (ElevenLabs premium or
 * Kokoro standard, see voice-provider.ts) and caches blobs per provider.
 */
export class VoiceAudioService {
  // Audio cache for generated segments
  private static audioCache: Map<string, { audioBlob: Blob; timestamp: number }> = new Map();
  private static readonly CACHE_MAX_SIZE = 50;
  private static readonly CACHE_MAX_AGE = 1000 * 60 * 60; // 1 hour

  /**
   * Generate cache key for audio segments
   */
  private static generateCacheKey(providerId: string, voiceId: string, text: string): string {
    // Simple hash function for text
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return `${providerId}:${voiceId}_${Math.abs(hash)}`;
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
   * Generate audio for a single segment with caching.
   *
   * Provider order: the player's mode (Premium / Standard). A premium 429
   * (quota) or 503 (outage) switches the session to Standard and retries this
   * segment there; any other status is returned as the segment's error.
   */
  static async generateAudio(segment: VoiceSegment, signal?: AbortSignal): Promise<VoiceSegment> {
    const voice: VoiceRef = {
      category: segment.voiceCategory ?? getVoiceCategoryKey({ id: segment.voiceId }),
      voiceId: segment.voiceId,
    };

    try {
      if (isStandardVoiceActive()) {
        return await VoiceAudioService.generateStandard(segment, voice, signal);
      }
      try {
        return await VoiceAudioService.generateWith(ElevenLabsProvider, segment, voice, signal);
      } catch (error) {
        if (!(error instanceof VoiceQuotaError || error instanceof VoiceUnavailableError)) {
          throw error;
        }
        activatePremiumFallback(error instanceof VoiceQuotaError ? 'quota' : 'unavailable');
        return await VoiceAudioService.generateStandard(segment, voice, signal);
      }
    } catch (error) {
      logger.error(`❌ Failed to generate audio for ${segment.character}:`, error);
      return {
        ...segment,
        error: error instanceof Error ? error.message : 'Audio generation failed',
        isGenerating: false,
      };
    }
  }

  private static async generateStandard(
    segment: VoiceSegment,
    voice: VoiceRef,
    signal?: AbortSignal,
  ): Promise<VoiceSegment> {
    const engine = await resolveStandardEngine();
    if (engine === 'speech-synthesis') {
      // Spoken at playback time by use-voice-processing; there is no blob to cache.
      return { ...segment, provider: 'speech-synthesis', isGenerating: false };
    }
    return VoiceAudioService.generateWith(KokoroProvider, segment, voice, signal);
  }

  private static async generateWith(
    provider: VoiceProvider,
    segment: VoiceSegment,
    voice: VoiceRef,
    signal?: AbortSignal,
  ): Promise<VoiceSegment> {
    const providerVoiceId = provider.resolveVoiceId(voice);
    const cacheKey = VoiceAudioService.generateCacheKey(provider.id, providerVoiceId, segment.text);

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
        provider: provider.id,
        isGenerating: false,
      };
    }

    logger.info(
      `🎵 Generating NEW audio (${provider.id}) for ${segment.character} with voice ${providerVoiceId}: "${segment.text.substring(0, 50)}..."`,
    );

    const { audioBlob, audioUrl } = await provider.generateAudio(
      segment.text,
      voice,
      segment.voiceSettings,
      signal,
    );

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
      provider: provider.id,
      isGenerating: false,
    };
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
