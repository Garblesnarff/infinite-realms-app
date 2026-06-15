/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { VoiceAudioService } from '../voice-audio-service';

import logger from '@/lib/logger';


// Mock logger
vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock URL.createObjectURL
if (typeof window !== 'undefined') {
  global.URL.createObjectURL = vi.fn(() => 'blob:http://localhost:3000/mock-url');
}

describe('VoiceAudioService', () => {
  const mockApiKey = 'test-api-key';
  const mockSegment: any = {
    voiceId: 'voice-1',
    text: 'Hello world',
    character: 'Narrator',
    voiceSettings: { stability: 0.5, similarity_boost: 0.75 },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    VoiceAudioService.clearAudioCache();
    vi.useFakeTimers();

    // Ensure fetch is mocked
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('generateAudio', () => {
    it('should generate new audio successfully and cache it', async () => {
      const mockArrayBuffer = new ArrayBuffer(8);
      const mockResponse = {
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(mockArrayBuffer),
      };
      (global.fetch as any).mockResolvedValue(mockResponse);

      const result = await VoiceAudioService.generateAudio(mockSegment, mockApiKey);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(mockSegment.voiceId),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'xi-api-key': mockApiKey,
          }),
        }),
      );
      expect(result.audioBlob).toBeDefined();
      expect(result.audioUrl).toBe('blob:http://localhost:3000/mock-url');
      expect(result.isGenerating).toBe(false);

      const stats = VoiceAudioService.getAudioCacheStats();
      expect(stats.size).toBe(1);
    });

    it('should return cached audio if available', async () => {
      const mockArrayBuffer = new ArrayBuffer(8);
      const mockResponse = {
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(mockArrayBuffer),
      };
      (global.fetch as any).mockResolvedValue(mockResponse);

      // First call to populate cache
      await VoiceAudioService.generateAudio(mockSegment, mockApiKey);
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Second call should hit cache
      const result = await VoiceAudioService.generateAudio(mockSegment, mockApiKey);
      expect(global.fetch).toHaveBeenCalledTimes(1); // Still 1
      expect(result.audioBlob).toBeDefined();
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Using cached audio for Narrator'),
      );
    });

    it('should handle API errors gracefully', async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      };
      (global.fetch as any).mockResolvedValue(mockResponse);

      const result = await VoiceAudioService.generateAudio(mockSegment, mockApiKey);

      expect(result.error).toContain('ElevenLabs API error: 500');
      expect(result.isGenerating).toBe(false);
      expect(logger.error).toHaveBeenCalled();
    });

    it('should handle network errors gracefully', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Network failure'));

      const result = await VoiceAudioService.generateAudio(mockSegment, mockApiKey);

      expect(result.error).toBe('Network failure');
      expect(result.isGenerating).toBe(false);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('Cache Management', () => {
    it('should manage cache size by removing oldest entries', async () => {
      // Mock fetch to always succeed
      (global.fetch as any).mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
      });

      // Fill cache to MAX_SIZE (50)
      // We need unique voiceId + text combinations for unique cache keys
      for (let i = 0; i < 50; i++) {
        await VoiceAudioService.generateAudio(
          { ...mockSegment, text: `text ${i}` },
          mockApiKey,
        );
        vi.advanceTimersByTime(1000); // Ensure different timestamps
      }

      expect(VoiceAudioService.getAudioCacheStats().size).toBe(50);

      // Add one more to trigger manageCacheSize
      await VoiceAudioService.generateAudio(
        { ...mockSegment, text: 'one more' },
        mockApiKey,
      );

      // manageCacheSize removes 10 oldest when size > 50
      // Current size: 50
      // Step 1: add 'one more' -> size becomes 51
      // Step 2: manageCacheSize triggers -> removes 10 oldest -> size becomes 41
      expect(VoiceAudioService.getAudioCacheStats().size).toBe(41);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Cleaned up 10 old audio cache entries'),
      );
    });

    it('should clean expired cache entries', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
      });

      await VoiceAudioService.generateAudio(mockSegment, mockApiKey);
      expect(VoiceAudioService.getAudioCacheStats().size).toBe(1);

      // Advance time past CACHE_MAX_AGE (1 hour)
      vi.advanceTimersByTime(1000 * 60 * 60 + 1);

      // Next call to generateAudio triggers cleanExpiredCache
      await VoiceAudioService.generateAudio(
        { ...mockSegment, text: 'new text' },
        mockApiKey,
      );

      // The old entry should be gone, only the new one remains
      expect(VoiceAudioService.getAudioCacheStats().size).toBe(1);
      const stats = VoiceAudioService.getAudioCacheStats();
      // The old key shouldn't be there
      expect(stats.keys).not.toContain(expect.stringContaining('Hello world'));
    });
  });

  describe('Utility Methods', () => {
    it('should clear cache', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
      });

      await VoiceAudioService.generateAudio(mockSegment, mockApiKey);
      expect(VoiceAudioService.getAudioCacheStats().size).toBe(1);

      VoiceAudioService.clearAudioCache();
      expect(VoiceAudioService.getAudioCacheStats().size).toBe(0);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Cleared 1 cached audio segments'),
      );
    });

    it('should return cache stats', () => {
      const stats = VoiceAudioService.getAudioCacheStats();
      expect(stats).toHaveProperty('size');
      expect(stats).toHaveProperty('keys');
    });
  });
});
