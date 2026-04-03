/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  normalizeCharacterName,
  hashCharacterName,
  detectVoiceCategoryFromNPCType,
  getVoicePoolByCharacter,
  getVoicePoolByCategory,
  assignVoice,
  ensureMapInitialized,
  clearCharacterVoiceMappings,
  VOICE_POOLS
} from '../voice-routing';

// Mock logger
vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('voice-routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCharacterVoiceMappings();
  });

  describe('normalizeCharacterName', () => {
    it('should lowercase and trim the name', () => {
      expect(normalizeCharacterName('  GANDALF  ')).toBe('gandalf');
    });

    it('should remove articles from the beginning', () => {
      expect(normalizeCharacterName('The Dragon')).toBe('dragon');
      expect(normalizeCharacterName('A Goblin')).toBe('goblin');
      expect(normalizeCharacterName('An Elf')).toBe('elf');
    });

    it('should remove special characters except hyphens and apostrophes', () => {
      expect(normalizeCharacterName('Drizzt Do\'Urden!')).toBe("drizzt do'urden");
      expect(normalizeCharacterName('Bork-Bork?')).toBe('bork-bork');
    });

    it('should normalize multiple spaces', () => {
      expect(normalizeCharacterName('Lord   Farquaad')).toBe('lord farquaad');
    });
  });

  describe('hashCharacterName', () => {
    it('should produce consistent results for the same string', () => {
      const name = 'elminster';
      expect(hashCharacterName(name)).toBe(hashCharacterName(name));
    });

    it('should produce different results for different strings', () => {
      expect(hashCharacterName('elminster')).not.toBe(hashCharacterName('elminster '));
    });

    it('should always return a non-negative number', () => {
      const result = hashCharacterName('!!!');
      expect(result).toBeGreaterThanOrEqual(0);
    });
  });

  describe('detectVoiceCategoryFromNPCType', () => {
    it('should detect guard category', () => {
      expect(detectVoiceCategoryFromNPCType('Town Guard')).toBe('guard');
      expect(detectVoiceCategoryFromNPCType('City Watch')).toBe('guard');
      expect(detectVoiceCategoryFromNPCType('Mercenary Captain')).toBe('guard');
    });

    it('should not classify unrelated watch substrings as guard', () => {
      expect(detectVoiceCategoryFromNPCType('The Watcher')).toBeUndefined();
    });

    it('should detect merchant category', () => {
      expect(detectVoiceCategoryFromNPCType('Traveling Merchant')).toBe('merchant');
      expect(detectVoiceCategoryFromNPCType('Shopkeep')).toBe('merchant');
    });

    it('should detect innkeeper category', () => {
      expect(detectVoiceCategoryFromNPCType('Barkeep')).toBe('innkeeper');
      expect(detectVoiceCategoryFromNPCType('Innkeeper')).toBe('innkeeper');
    });

    it('should detect elder category for magical types', () => {
      expect(detectVoiceCategoryFromNPCType('High Wizard')).toBe('elder');
      expect(detectVoiceCategoryFromNPCType('Archmage')).toBe('elder');
      expect(detectVoiceCategoryFromNPCType('Sage')).toBe('elder');
    });

    it('should detect hero category for nobles', () => {
      expect(detectVoiceCategoryFromNPCType('The Duke of Wellington')).toBe('hero');
      expect(detectVoiceCategoryFromNPCType('Princess Zelda')).toBe('hero');
    });

    it('should detect creature category', () => {
      expect(detectVoiceCategoryFromNPCType('Angry Goblin')).toBe('creature');
      expect(detectVoiceCategoryFromNPCType('Ancient Red Dragon')).toBe('creature');
    });

    it('should detect villain category', () => {
      expect(detectVoiceCategoryFromNPCType('Evil Necromancer')).toBe('villain');
      expect(detectVoiceCategoryFromNPCType('Dark Cultist')).toBe('villain');
    });

    it('should return undefined for unknown types', () => {
      expect(detectVoiceCategoryFromNPCType('Random Farmer')).toBeUndefined();
    });

    it('should prioritize creature over elder for ancient creature', () => {
      expect(detectVoiceCategoryFromNPCType('Ancient Dragon')).toBe('creature');
    });
  });

  describe('getVoicePoolByCategory', () => {
    it('should return correct pools for categories', () => {
      expect(getVoicePoolByCategory('narrator')).toEqual(VOICE_POOLS.dm);
      expect(getVoicePoolByCategory('hero_male')).toEqual(VOICE_POOLS.heroes);
      expect(getVoicePoolByCategory('villain_female')).toEqual(VOICE_POOLS.villains);
      expect(getVoicePoolByCategory('monster')).toEqual(VOICE_POOLS.creatures);
      expect(getVoicePoolByCategory('merchant')).toEqual(VOICE_POOLS.npcs);
    });

    it('should fallback to npcs pool for unknown categories', () => {
      expect(getVoicePoolByCategory('unknown')).toEqual(VOICE_POOLS.npcs);
    });
  });

  describe('getVoicePoolByCharacter', () => {
    it('should detect villain pool from keywords', () => {
      expect(getVoicePoolByCharacter('The Evil One')).toEqual(VOICE_POOLS.villains);
      expect(getVoicePoolByCharacter('Dark Lord')).toEqual(VOICE_POOLS.villains);
      expect(getVoicePoolByCharacter('Bandit')).toEqual(VOICE_POOLS.villains);
    });

    it('should detect creature pool from keywords', () => {
      expect(getVoicePoolByCharacter('Ancient Dragon')).toEqual(VOICE_POOLS.creatures);
      expect(getVoicePoolByCharacter('Cave Troll')).toEqual(VOICE_POOLS.creatures);
    });

    it('should detect hero pool from keywords', () => {
      expect(getVoicePoolByCharacter('Brave Champion')).toEqual(VOICE_POOLS.heroes);
      expect(getVoicePoolByCharacter('Silver Knight')).toEqual(VOICE_POOLS.heroes);
    });

    it('should default to npcs pool', () => {
      expect(getVoicePoolByCharacter('Farmer John')).toEqual(VOICE_POOLS.npcs);
    });
  });

  describe('hashCharacterName', () => {
    it('should handle empty name', () => {
      expect(hashCharacterName('')).toBe(0);
    });
  });

  describe('getVoicePoolByCategory', () => {
    it('should handle various case inputs', () => {
      expect(getVoicePoolByCategory('HERO_MALE')).toEqual(VOICE_POOLS.heroes);
    });
  });

  describe('assignVoice', () => {
    it('should handle character with no name', () => {
      const segment: any = { type: 'character', character: '', text: 'Hello' };
      const voice = assignVoice(segment);
      expect(voice).toEqual(VOICE_POOLS.dm[0]);
    });

    it('should always assign the DM voice to dm type segments', () => {
      const segment: any = { type: 'dm', text: 'Narration' };
      const voice = assignVoice(segment);
      expect(voice).toEqual(VOICE_POOLS.dm[0]);
    });

    it('should assign a consistent voice to a character', () => {
      const segment: any = { type: 'character', character: 'Elara', text: 'Hello' };
      const voice1 = assignVoice(segment);

      const segment2: any = { type: 'character', character: 'Elara', text: 'Goodbye' };
      const voice2 = assignVoice(segment2);

      expect(voice1).toBe(voice2);
    });

    it('should use voice_category hint if provided for new assignments', () => {
      const segment: any = {
        type: 'character',
        character: 'New Guy',
        text: 'Hello',
        voice_category: 'villain'
      };
      const voice = assignVoice(segment);
      // 'villain' category maps to villains pool
      expect(VOICE_POOLS.villains).toContain(voice);
    });

    it('should fallback to DM voice if no character is provided for character type', () => {
      const segment: any = { type: 'character', text: 'Hello' };
      const voice = assignVoice(segment);
      expect(voice).toEqual(VOICE_POOLS.dm[0]);
    });
  });

  describe('map management', () => {
    it('should initialize the map', () => {
      const map = ensureMapInitialized();
      expect(map).toBeDefined();
      expect(map instanceof Map).toBe(true);
    });

    it('should clear mappings', () => {
      const segment: any = { type: 'character', character: 'Elara', text: 'Hello' };
      assignVoice(segment);

      clearCharacterVoiceMappings();
      const map = ensureMapInitialized();
      expect(map.size).toBe(0);
    });
  });
});
