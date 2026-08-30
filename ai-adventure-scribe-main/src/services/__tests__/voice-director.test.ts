/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { VoiceAudioService } from '../voice/voice-audio-service';
import { VOICE_CONFIGS } from '../voice/voice-constants';
import { VOICE_POOLS } from '../voice/voice-pools';
import { VoiceDirector } from '../voice-director';
import * as routing from '../voice-routing';
import { clearCharacterVoiceMappings } from '../voice-routing';

// Mock logger
vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock VoiceAudioService
vi.mock('../voice/voice-audio-service', () => ({
  VoiceAudioService: {
    generateAudio: vi.fn(async (segment) => ({ ...segment, audioUrl: 'mock-url' })),
    clearAudioCache: vi.fn(),
    getAudioCacheStats: vi.fn(() => ({ size: 0, keys: [] })),
  },
}));

describe('VoiceDirector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCharacterVoiceMappings();
  });

  describe('validateAISegments', () => {
    it('should validate and clean segments', () => {
      const input = [
        { type: 'dm', text: 'Hello' },
        { type: 'character', text: 'Hi', character: 'Elara' },
        { type: 'invalid', text: 'Wait' }, // Should be converted to 'dm'
        { type: 'dm', text: '  ' }, // Should be skipped
      ];

      const result = VoiceDirector.validateAISegments(input as any);
      expect(result.length).toBe(3);
      expect(result[0].type).toBe('dm');
      expect(result[1].character).toBe('Elara');
      expect(result[2].type).toBe('dm'); // 'invalid' -> 'dm'
    });

    it('should handle missing text in validation', () => {
      const input = [{ type: 'dm', text: '' }];
      const result = VoiceDirector.validateAISegments(input as any);
      expect(result.length).toBe(0);
    });
  });

  describe('processAISegments', () => {
    it('should convert AI segments to VoiceSegments', () => {
      const input = [
        { type: 'dm', text: 'The sun rises.' },
        { type: 'character', text: 'Good morning!', character: 'Sun' },
      ];

      const result = VoiceDirector.processAISegments(input as any);
      expect(result.length).toBe(2);
      expect(result[0].character).toBe('DM');
      expect(result[0].voiceId).toBe(VOICE_POOLS.dm[0].id);
      expect(result[1].character).toBe('Sun');
      expect(result[1].text).toBe('Good morning!');
      expect(result[1].voiceId).toBeDefined();
    });

    it('should retain distinct voice IDs for narrator and gruff character categories', () => {
      const result = VoiceDirector.processAISegments([
        {
          type: 'character',
          text: 'The road is clear.',
          character: 'Veteran',
          voice_category: 'Narrator',
        },
        { type: 'character', text: 'Halt.', character: 'Sergeant Vance', voice_category: 'gruff' },
      ]);

      expect(result.map((segment) => segment.voiceId)).toEqual([
        VOICE_CONFIGS.narrator.id,
        VOICE_CONFIGS.guard.id,
      ]);
      expect(result[0].voiceId).not.toBe(result[1].voiceId);
    });

    it('should handle empty segments in processAISegments', () => {
      const input = [{ type: 'dm', text: ' ' }];
      const result = VoiceDirector.processAISegments(input as any);
      expect(result.length).toBe(0);
    });

    it('should exclude engine transcript lines before creating voice segments', () => {
      const engineLine = '⚙️ Engine: The Storyteller rolled 16 + 4 = 20 vs AC 12 — HIT.';
      const result = VoiceDirector.processAISegments([
        { type: 'dm', text: `${engineLine}\n\nThe ward shatters.` },
        { type: 'dm', text: engineLine },
      ] as any);

      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('The ward shatters.');
      expect(result[0].text).not.toContain('Engine:');
    });

    it('should clean text by removing markdown and extra whitespace', () => {
      const input = [{ type: 'dm', text: '  **Bold** _Italic_   ' }];
      const result = VoiceDirector.processAISegments(input as any);
      expect(result[0].text).toBe('Bold Italic');
    });

    it('should handle errors during processing', () => {
      const spy = vi.spyOn(routing, 'assignVoice').mockImplementation(() => {
        throw new Error('Test Error');
      });

      const input = [{ type: 'dm', text: 'Hello' }];
      const result = VoiceDirector.processAISegments(input as any);

      expect(result.length).toBe(0);
      spy.mockRestore();
    });
  });

  describe('processPlainText', () => {
    it('should return an empty array for empty text', () => {
      expect(VoiceDirector.processPlainText('')).toEqual([]);
    });

    it('should return a single DM segment if no dialogue is found', () => {
      const text = 'This is a test of the narration system.';
      const result = VoiceDirector.processPlainText(text);
      expect(result.length).toBe(1);
      expect(result[0].character).toBe('DM');
      expect(result[0].text).toBe(text);
    });

    it('should extract dialogue and narration', () => {
      const text = 'The guard says "Halt!"';
      const result = VoiceDirector.processPlainText(text);

      expect(result.length).toBe(1);
      expect(result[0].type).toBe('character');
      expect(result[0].text).toBe('Halt!');
      expect(result[0].character).toBe('guard');
    });

    it('should handle multiple dialogue parts', () => {
      const text = '"Hello," says Elara. "How are you?"';
      const result = VoiceDirector.processPlainText(text);

      expect(result.length).toBe(3);
      expect(result[0].type).toBe('character');
      expect(result[0].text).toBe('Hello,');
      expect(result[1].type).toBe('dm'); // "says Elara."
      expect(result[2].type).toBe('character');
      expect(result[2].text).toBe('How are you?');
    });

    it('should attribute character name from pre-quote pattern', () => {
      const text = 'Elara whispers "I am here."';
      const result = VoiceDirector.processPlainText(text);
      expect(result.length).toBe(1);
      expect(result[0].type).toBe('character');
      expect(result[0].character).toBe('Elara');
      expect(result[0].text).toBe('I am here.');
    });

    it('should attribute character name from post-quote pattern', () => {
      const text = '"Go away," growls the orc.';
      const result = VoiceDirector.processPlainText(text);
      expect(result[0].character).toBe('orc');
    });
  });

  describe('delegated methods', () => {
    it('should delegate getAvailableVoiceCategories', () => {
      const categories = VoiceDirector.getAvailableVoiceCategories();
      expect(categories).toContain('narrator');
      expect(categories).toContain('hero_male');
    });

    it('should delegate generateAudio', async () => {
      const segment: any = { voiceId: 'v1', text: 'test' };
      const result = await VoiceDirector.generateAudio(segment);
      expect(result.audioUrl).toBe('mock-url');
    });

    it('should delegate clearAudioCache', () => {
      VoiceDirector.clearAudioCache();
      expect(VoiceAudioService.clearAudioCache).toHaveBeenCalled();
    });

    it('should delegate getAudioCacheStats', () => {
      const stats = VoiceDirector.getAudioCacheStats();
      expect(stats).toEqual({ size: 0, keys: [] });
      expect(VoiceAudioService.getAudioCacheStats).toHaveBeenCalled();
    });

    it('should delegate getCharacterVoiceMappings', () => {
      const mappings = VoiceDirector.getCharacterVoiceMappings();
      expect(mappings).toBeDefined();
    });

    it('should delegate clearCharacterVoiceMappings', () => {
      VoiceDirector.clearCharacterVoiceMappings();
      // Should not throw
    });
  });
});
