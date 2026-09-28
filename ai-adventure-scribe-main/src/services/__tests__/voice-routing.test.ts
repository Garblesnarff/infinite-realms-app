/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { VOICE_CATEGORY_ALIASES } from '../../../server-bun/src/services/dm/dm-response-schema';
import { VOICE_CONFIGS } from '../voice/voice-constants';
import {
  normalizeCharacterName,
  hashCharacterName,
  assignVoice,
  ensureMapInitialized,
  clearCharacterVoiceMappings,
  getCharacterVoiceMappings,
  VOICE_POOLS,
  getVoiceConfigByCategory,
  detectVoiceCategoryFromNPCType,
  getVoicePoolByCharacter,
} from '../voice-routing';

import logger from '@/lib/logger';

// Mock logger. Both `default` and the named `logger` export are provided:
// the modules under test import the named export (#2313).
vi.mock('@/lib/logger', () => {
  const m = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return {
    __esModule: true,
    default: m,
    logger: m,
  };
});

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
      expect(normalizeCharacterName("Drizzt Do'Urden!")).toBe("drizzt do'urden");
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

  describe('getVoiceConfigByCategory', () => {
    it('should resolve category labels to configured voices', () => {
      expect(getVoiceConfigByCategory('Narrator')).toBe(VOICE_CONFIGS.narrator);
      expect(getVoiceConfigByCategory('hero_male')).toBe(VOICE_CONFIGS.hero_male);
      expect(getVoiceConfigByCategory('villain_female')).toBe(VOICE_CONFIGS.villain_female);
      expect(getVoiceConfigByCategory('monster')).toBe(VOICE_CONFIGS.monster);
      expect(getVoiceConfigByCategory('merchant')).toBe(VOICE_CONFIGS.merchant);
      expect(getVoiceConfigByCategory('gruff')).toBe(VOICE_CONFIGS.guard);
      expect(getVoiceConfigByCategory('high-pitched, fast, breathless')).toBe(VOICE_CONFIGS.goblin);
      expect(getVoiceConfigByCategory('calm')).toBe(VOICE_CONFIGS.innkeeper);
      expect(getVoiceConfigByCategory('narrative')).toBe(VOICE_CONFIGS.narrator);
    });

    it('should warn and fallback to the narrator voice for unknown categories', () => {
      expect(getVoiceConfigByCategory('unknown')).toBe(VOICE_CONFIGS.narrator);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Unmapped voice category "unknown"'),
      );
    });

    it('should normalize case before lookup', () => {
      expect(getVoiceConfigByCategory('HERO_MALE')).toBe(VOICE_CONFIGS.hero_male);
    });

    it('maps every schema voice alias to a configured ElevenLabs voice', () => {
      const aliases = Object.entries(VOICE_CATEGORY_ALIASES);
      expect(aliases.length).toBeGreaterThan(0);

      for (const [alias, target] of aliases) {
        expect(VOICE_CONFIGS[target], `alias "${alias}" -> "${target}"`).toBeDefined();
      }
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

  describe('assignVoice', () => {
    it('should handle character with no name', () => {
      const segment: any = { type: 'character', character: '', text: 'Hello' };
      const voice = assignVoice(segment);
      expect(voice.id).toBe(VOICE_CONFIGS.narrator.id);
    });

    it('should always assign the DM voice to dm type segments', () => {
      const segment: any = { type: 'dm', text: 'Narration' };
      const voice = assignVoice(segment);
      expect(voice.id).toBe(VOICE_CONFIGS.narrator.id);
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
        voice_category: 'villain',
      };
      const voice = assignVoice(segment);
      // 'villain' category resolves to the configured male villain voice.
      expect(voice.id).toBe(VOICE_CONFIGS.villain_male.id);
    });

    it('should resolve narrator and gruff labels to different configured voice IDs', () => {
      const narratorVoice = assignVoice({
        type: 'character',
        character: 'Veteran',
        text: 'The road is clear.',
        voice_category: 'Narrator',
      });
      const guardVoice = assignVoice({
        type: 'character',
        character: 'Sergeant Vance',
        text: 'Halt.',
        voice_category: 'gruff',
      });

      expect(narratorVoice.id).toBe(VOICE_CONFIGS.narrator.id);
      expect(guardVoice.id).toBe(VOICE_CONFIGS.guard.id);
      expect(guardVoice.id).not.toBe(narratorVoice.id);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('should warn and use narrator voice for an unmapped category', () => {
      const voice = assignVoice({
        type: 'character',
        character: 'Mystery NPC',
        text: 'Who am I?',
        voice_category: 'unmapped_style',
      });

      expect(voice.id).toBe(VOICE_CONFIGS.narrator.id);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Unmapped voice category "unmapped_style"'),
      );
      expect(getCharacterVoiceMappings()).toEqual({});
    });

    it('should assign the narrator voice to a narrator segment', () => {
      const voice = assignVoice({
        type: 'dm',
        text: 'The lantern gutters.',
        voice_category: 'narrator',
      });

      expect(voice.id).toBe(VOICE_CONFIGS.narrator.id);
    });

    it('should resolve an NPC dialogue segment to that NPC voice', () => {
      const voice = assignVoice({
        type: 'character',
        character: 'Serena',
        text: 'Welcome.',
        voice_category: 'innkeeper',
      });

      expect(voice).toBe(VOICE_CONFIGS.innkeeper);
      expect(voice.id).not.toBe(VOICE_CONFIGS.narrator.id);
    });

    it('should use narrator for an unknown speaker without caching it', () => {
      const voice = assignVoice({
        type: 'character',
        character: 'Unknown NPC',
        text: 'Who am I?',
        voice_category: 'merchant',
      });

      expect(voice.id).toBe(VOICE_CONFIGS.narrator.id);
      expect(getCharacterVoiceMappings()).toEqual({});
    });

    it('should not cache reopen free-text misses, but should cache resolved aliases', () => {
      const breathless = assignVoice({
        type: 'character',
        character: 'Professor Emil Darkwater',
        text: 'P-please...',
        voice_category: 'high-pitched, fast, breathless',
      });
      const calm = assignVoice({
        type: 'character',
        character: 'Innkeep Mara',
        text: 'Sit down.',
        voice_category: 'calm',
      });
      const narrative = assignVoice({
        type: 'character',
        character: 'Veteran',
        text: 'The road is clear.',
        voice_category: 'narrative',
      });

      expect(breathless.id).toBe(VOICE_CONFIGS.goblin.id);
      expect(calm.id).toBe(VOICE_CONFIGS.innkeeper.id);
      expect(narrative.id).toBe(VOICE_CONFIGS.narrator.id);
      expect(getCharacterVoiceMappings()['professor emil darkwater']).toBe(
        VOICE_CONFIGS.goblin.name,
      );
      expect(getCharacterVoiceMappings()['innkeep mara']).toBe(VOICE_CONFIGS.innkeeper.name);
    });

    it('should fallback to DM voice if no character is provided for character type', () => {
      const segment: any = { type: 'character', text: 'Hello' };
      const voice = assignVoice(segment);
      expect(voice.id).toBe(VOICE_CONFIGS.narrator.id);
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
