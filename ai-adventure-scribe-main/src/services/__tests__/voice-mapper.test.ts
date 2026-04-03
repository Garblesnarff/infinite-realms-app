/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VoiceMapper } from '../voice-mapper';
import logger from '@/lib/logger';

// Mock logger
vi.mock('@/lib/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('VoiceMapper', () => {
  const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
      getItem: vi.fn((key: string) => store[key] || null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value.toString();
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key];
      }),
      clear: vi.fn(() => {
        store = {};
      }),
    };
  })();

  Object.defineProperty(window, 'localStorage', {
    value: localStorageMock,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  describe('getVoiceForCharacter', () => {
    it('should return default voice for empty or unknown character', () => {
      const defaultVoice = VoiceMapper.getAllVoices().default;

      expect(VoiceMapper.getVoiceForCharacter('')).toEqual(defaultVoice);
      expect(VoiceMapper.getVoiceForCharacter('unknown')).toEqual(defaultVoice);
      expect(VoiceMapper.getVoiceForCharacter(null as any)).toEqual(defaultVoice);
    });

    it('should normalize character names (trim and lowercase)', () => {
      const monsterVoice = VoiceMapper.getAllVoices().monster;
      // 'dragon' is a keyword for 'monster'
      expect(VoiceMapper.getVoiceForCharacter('  DRAGON  ')).toEqual(monsterVoice);
    });

    it('should use saved mapping if it exists in localStorage', () => {
      const villainVoice = VoiceMapper.getAllVoices().villain_male;
      localStorage.setItem('character-voice-mappings', JSON.stringify({ 'bob': 'villain_male' }));

      const result = VoiceMapper.getVoiceForCharacter('Bob');
      expect(result).toEqual(villainVoice);
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Found saved voice mapping'));
    });

    it('should match keywords and save the mapping', () => {
      const merchantVoice = VoiceMapper.getAllVoices().merchant;
      // 'trader' is a keyword for 'merchant'
      const result = VoiceMapper.getVoiceForCharacter('The Trader');

      expect(result).toEqual(merchantVoice);
      const saved = JSON.parse(localStorage.getItem('character-voice-mappings') || '{}');
      expect(saved['the trader']).toBe('merchant');
    });

    it('should prioritize keywords based on loop order (monster before guard)', () => {
      const monsterVoice = VoiceMapper.getAllVoices().monster;
      // 'dragon captain' has 'dragon' (monster) and 'captain' (guard)
      // 'monster' is checked before 'guard' in CHARACTER_KEYWORDS
      const result = VoiceMapper.getVoiceForCharacter('dragon captain');
      expect(result).toEqual(monsterVoice);
    });

    it('should use smart classification heuristics if no keywords match', () => {
      const heroVoice = VoiceMapper.getAllVoices().hero_male;
      const guardVoice = VoiceMapper.getAllVoices().guard;
      const elderVoice = VoiceMapper.getAllVoices().elder;

      expect(VoiceMapper.getVoiceForCharacter('Sir Alistair')).toEqual(heroVoice);
      expect(VoiceMapper.getVoiceForCharacter('Captain Vimes')).toEqual(guardVoice);
      expect(VoiceMapper.getVoiceForCharacter('Master Elodin')).toEqual(elderVoice);
    });

    it('should fallback to default if no keywords or heuristics match', () => {
      const defaultVoice = VoiceMapper.getAllVoices().default;
      expect(VoiceMapper.getVoiceForCharacter('Just Some Guy')).toEqual(defaultVoice);
    });
  });

  describe('Utility Methods', () => {
    it('getNarratorVoice should return the narrator config', () => {
      const voice = VoiceMapper.getNarratorVoice();
      expect(voice.category).toBe('narrator');
      expect(voice.name).toBe('Will');
    });

    it('getAllVoices should return all configurations', () => {
      const all = VoiceMapper.getAllVoices();
      expect(all.narrator).toBeDefined();
      expect(all.monster).toBeDefined();
      expect(all.default).toBeDefined();
    });

    it('updateCharacterVoice should save a specific mapping', () => {
      const success = VoiceMapper.updateCharacterVoice('Legolas', 'hero_male');
      expect(success).toBe(true);

      const saved = VoiceMapper.getSavedMappings();
      expect(saved['legolas']).toBe('hero_male');
    });

    it('updateCharacterVoice should return false for invalid voice type', () => {
      const success = VoiceMapper.updateCharacterVoice('Legolas', 'invalid_voice');
      expect(success).toBe(false);
    });

    it('clearSavedMappings should empty the storage', () => {
      localStorage.setItem('character-voice-mappings', JSON.stringify({ a: 'b' }));
      VoiceMapper.clearSavedMappings();
      expect(localStorage.getItem('character-voice-mappings')).toBeNull();
    });

    it('getVoiceCategories should group voices by category', () => {
      const categories = VoiceMapper.getVoiceCategories();
      expect(categories.narrator).toBeDefined();
      expect(categories.hero).toBeDefined();
      expect(categories.creature).toBeDefined();
      // Verify that 'Will' is in narrator (and maybe others but categorized)
      expect(categories.narrator[0].name).toBe('Will');
    });

    it('debugAndClearCharacter should remove mapping and then re-assign', () => {
      // First assign 'merchant' to 'bob' via keyword
      VoiceMapper.getVoiceForCharacter('Bob the merchant');
      expect(VoiceMapper.getSavedMappings()['bob the merchant']).toBe('merchant');

      // Now debug and clear
      VoiceMapper.debugAndClearCharacter('Bob the merchant');

      // It deletes it, but then calls getVoiceForCharacter which RE-SAVES it.
      // So we check that it was called and re-saved.
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Cleared mapping for "bob the merchant"'));
      expect(VoiceMapper.getSavedMappings()['bob the merchant']).toBe('merchant');
    });
  });

  describe('Error Handling', () => {
    it('should handle localStorage corruption gracefully', () => {
      localStorage.setItem('character-voice-mappings', 'invalid json');

      // Should not throw, should return default
      const result = VoiceMapper.getVoiceForCharacter('Some Name');
      expect(result).toEqual(VoiceMapper.getAllVoices().default);
      expect(logger.warn).toHaveBeenCalled();
    });
  });
});
