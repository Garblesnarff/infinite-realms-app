/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  getMaxSpellCounts,
  isSpellValidForClass,
  isSpellValidForClassAsync,
  calculateMulticlassCasterLevel,
  getEnhancedSpellcastingInfo,
  getSpellValidationRules,
} from '../utils';

import type * as SpellOptionsModule from '@/data/spellOptions';
import type { Character, CharacterClass } from '@/types/character';
import type * as SpellcastingInfoModule from '@/utils/spell-validation/spellcasting-info';



import { getClassSpells } from '@/data/spellOptions';
import logger from '@/lib/logger';
import { spellApi } from '@/services/spellApi';
import { getSpellcastingInfo } from '@/utils/spell-validation/spellcasting-info';

// Mock dependencies
vi.mock('@/lib/logger', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/services/spellApi', () => ({
  spellApi: {
    calculateMulticlassCasterLevel: vi.fn(),
  },
}));

vi.mock('@/utils/spell-validation/spellcasting-info', async (importOriginal) => {
  const original = await importOriginal<typeof SpellcastingInfoModule>();
  return {
    ...original,
    getSpellcastingInfo: vi.fn(original.getSpellcastingInfo),
  };
});

vi.mock('@/data/spellOptions', async (importOriginal) => {
  const original = await importOriginal<typeof SpellOptionsModule>();
  return {
    ...original,
    getClassSpells: vi.fn(original.getClassSpells),
  };
});

describe('Spell Validation Utils', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('getMaxSpellCounts', () => {
    it('should return zeros for non-spellcasters', () => {
      const mockClass: CharacterClass = { name: 'Fighter' } as any;
      const counts = getMaxSpellCounts(mockClass);
      expect(counts).toEqual({ cantrips: 0, spells: 0 });
    });

    it('should return zeros for Paladin at level 1 (as they do not have spellcasting at level 1)', () => {
      const mockClass: CharacterClass = { name: 'Paladin', spellcasting: { ability: 'charisma' } } as any;
      const counts = getMaxSpellCounts(mockClass, 1);
      expect(counts).toEqual({ cantrips: 0, spells: 0 });
    });

    it('should return correct counts using spellsKnown for class like Bard', () => {
      const mockClass: CharacterClass = { name: 'Bard', spellcasting: { ability: 'charisma' } } as any;
      const counts = getMaxSpellCounts(mockClass, 1);
      expect(counts).toEqual({ cantrips: 2, spells: 4 });
    });

    it('should return correct counts using spellsPrepared for class like Cleric', () => {
      const mockClass: CharacterClass = { name: 'Cleric', spellcasting: { ability: 'wisdom' } } as any;
      const counts = getMaxSpellCounts(mockClass, 1);
      expect(counts).toEqual({ cantrips: 3, spells: 1 });
    });

    it('should handle level parameter defaulting to 1', () => {
      const mockClass: CharacterClass = { name: 'Bard', spellcasting: { ability: 'charisma' } } as any;
      const counts = getMaxSpellCounts(mockClass);
      expect(counts).toEqual({ cantrips: 2, spells: 4 });
    });

    it('should correctly scale Druid spell counts based on level', () => {
      const mockClass: CharacterClass = { name: 'Druid', spellcasting: { ability: 'wisdom' } } as any;
      expect(getMaxSpellCounts(mockClass, 1)).toEqual({ cantrips: 2, spells: 1 });
      expect(getMaxSpellCounts(mockClass, 5)).toEqual({ cantrips: 3, spells: 5 });
      expect(getMaxSpellCounts(mockClass, 11)).toEqual({ cantrips: 4, spells: 11 });
    });

    it('should correctly scale Ranger spell counts based on level', () => {
      const mockClass: CharacterClass = { name: 'Ranger', spellcasting: { ability: 'wisdom' } } as any;
      expect(getMaxSpellCounts(mockClass, 1)).toEqual({ cantrips: 0, spells: 0 });
      expect(getMaxSpellCounts(mockClass, 2)).toEqual({ cantrips: 0, spells: 2 });
      expect(getMaxSpellCounts(mockClass, 5)).toEqual({ cantrips: 0, spells: 5 });
      expect(getMaxSpellCounts(mockClass, 15)).toEqual({ cantrips: 0, spells: 14 });
    });
  });

  describe('isSpellValidForClass', () => {
    it('should return false if class name or spellId is missing', () => {
      expect(isSpellValidForClass('', 'Wizard')).toBe(false);
      expect(isSpellValidForClass('mage-hand', '')).toBe(false);
      expect(isSpellValidForClass('mage-hand', { name: '' } as any)).toBe(false);
    });

    it('should accept characterClass as a string', () => {
      const mockCantrips = [{ id: 'mage-hand' }];
      const mockSpells = [{ id: 'magic-missile' }];
      vi.mocked(getClassSpells).mockReturnValue({ cantrips: mockCantrips, spells: mockSpells } as any);

      const isValid = isSpellValidForClass('mage-hand', 'Wizard');
      expect(getClassSpells).toHaveBeenCalledWith('Wizard');
      expect(isValid).toBe(true);
    });

    it('should accept characterClass as a CharacterClass object', () => {
      const mockCantrips = [{ id: 'mage-hand' }];
      const mockSpells = [{ id: 'magic-missile' }];
      vi.mocked(getClassSpells).mockReturnValue({ cantrips: mockCantrips, spells: mockSpells } as any);

      const isValid = isSpellValidForClass('mage-hand', { name: 'Wizard' } as any);
      expect(getClassSpells).toHaveBeenCalledWith('Wizard');
      expect(isValid).toBe(true);
    });

    it('should filter by isCantrip = true', () => {
      const mockCantrips = [{ id: 'mage-hand' }];
      const mockSpells = [{ id: 'magic-missile' }];
      vi.mocked(getClassSpells).mockReturnValue({ cantrips: mockCantrips, spells: mockSpells } as any);

      // exists in cantrips
      expect(isSpellValidForClass('mage-hand', 'Wizard', true)).toBe(true);
      // exists in spells but checking only cantrips
      expect(isSpellValidForClass('magic-missile', 'Wizard', true)).toBe(false);
    });

    it('should filter by isCantrip = false', () => {
      const mockCantrips = [{ id: 'mage-hand' }];
      const mockSpells = [{ id: 'magic-missile' }];
      vi.mocked(getClassSpells).mockReturnValue({ cantrips: mockCantrips, spells: mockSpells } as any);

      // exists in spells
      expect(isSpellValidForClass('magic-missile', 'Wizard', false)).toBe(true);
      // exists in cantrips but checking only spells
      expect(isSpellValidForClass('mage-hand', 'Wizard', false)).toBe(false);
    });

    it('should check both cantrips and spells if isCantrip is not specified', () => {
      const mockCantrips = [{ id: 'mage-hand' }];
      const mockSpells = [{ id: 'magic-missile' }];
      vi.mocked(getClassSpells).mockReturnValue({ cantrips: mockCantrips, spells: mockSpells } as any);

      expect(isSpellValidForClass('mage-hand', 'Wizard')).toBe(true);
      expect(isSpellValidForClass('magic-missile', 'Wizard')).toBe(true);
      expect(isSpellValidForClass('fireball', 'Wizard')).toBe(false);
    });

    it('should catch errors gracefully and log them', () => {
      vi.mocked(getClassSpells).mockImplementation(() => {
        throw new Error('Database down');
      });

      const result = isSpellValidForClass('mage-hand', 'Wizard');
      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        '[SpellValidation] Local class spell validation failed:',
        expect.any(Error),
      );
    });
  });

  describe('isSpellValidForClassAsync', () => {
    it('should return true if API call is successful and spell is valid', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ isValid: true }),
      };
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const result = await isSpellValidForClassAsync('mage-hand', 'Wizard');
      expect(global.fetch).toHaveBeenCalledWith('/api/spells/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spellId: 'mage-hand', characterClass: 'Wizard' }),
      });
      expect(result).toBe(true);
    });

    it('should return false if API call is successful but spell is invalid', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ isValid: false }),
      };
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const result = await isSpellValidForClassAsync('mage-hand', 'Wizard');
      expect(result).toBe(false);
    });

    it('should handle default result if json is missing isValid', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({}),
      };
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const result = await isSpellValidForClassAsync('mage-hand', 'Wizard');
      expect(result).toBe(false);
    });

    it('should log error and return false if response is not ok', async () => {
      const mockResponse = {
        ok: false,
        statusText: 'Bad Request',
      };
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const result = await isSpellValidForClassAsync('mage-hand', 'Wizard');
      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        'Spell validation API call failed for mage-hand/Wizard:',
        'Bad Request',
      );
    });

    it('should log error and return false if fetch throws', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network Error'));

      const result = await isSpellValidForClassAsync('mage-hand', 'Wizard');
      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        'Error during spell validation API call for mage-hand/Wizard:',
        expect.any(Error),
      );
    });
  });

  describe('calculateMulticlassCasterLevel', () => {
    it('should call spellApi and return the results', async () => {
      const mockResult = {
        totalCasterLevel: 3,
        spellSlots: [4, 2],
        pactMagicSlots: null,
      };
      vi.mocked(spellApi.calculateMulticlassCasterLevel).mockResolvedValue(mockResult as any);

      const classLevels = [{ className: 'Wizard', level: 2 }, { className: 'Cleric', level: 1 }];
      const result = await calculateMulticlassCasterLevel(classLevels);

      expect(spellApi.calculateMulticlassCasterLevel).toHaveBeenCalledWith(classLevels);
      expect(result).toEqual(mockResult);
    });

    it('should catch errors, log them, and return default values', async () => {
      vi.mocked(spellApi.calculateMulticlassCasterLevel).mockRejectedValue(new Error('RPC failure'));

      const result = await calculateMulticlassCasterLevel([]);
      expect(result).toEqual({
        totalCasterLevel: 0,
        spellSlots: null,
        pactMagicSlots: null,
      });
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to calculate multiclass caster level:',
        expect.any(Error),
      );
    });
  });

  describe('getEnhancedSpellcastingInfo', () => {
    it('should return null if base spellcasting is null', async () => {
      const mockCharacter: Character = {
        name: 'Fighter Guy',
        class: { name: 'Fighter' } as any,
      } as any;

      const result = await getEnhancedSpellcastingInfo(mockCharacter);
      expect(result).toBeNull();
    });

    it('should return base info if character is single-class', async () => {
      const mockCharacter: Character = {
        name: 'Wizard Guy',
        class: { name: 'Wizard', spellcasting: { ability: 'intelligence' } } as any,
        level: 3,
      } as any;

      const result = await getEnhancedSpellcastingInfo(mockCharacter);
      expect(result).not.toBeNull();
      expect(result?.multiclassInfo).toBeUndefined();
      expect(result?.cantripsKnown).toBe(3); // Level 3 wizard has 3 cantrips
    });

    it('should fallback to level 1 if character level is missing', async () => {
      const mockCharacter: Character = {
        name: 'Wizard Guy',
        class: { name: 'Wizard', spellcasting: { ability: 'intelligence' } } as any,
      } as any; // level is missing

      const result = await getEnhancedSpellcastingInfo(mockCharacter);
      expect(result).not.toBeNull();
      expect(result?.cantripsKnown).toBe(3); // Level 1 wizard has 3 cantrips
    });

    it('should call calculateMulticlassCasterLevel and merge info if character has multiple classLevels', async () => {
      const mockCharacter: Character = {
        name: 'Multi Guy',
        class: { name: 'Wizard', spellcasting: { ability: 'intelligence' } } as any,
        level: 3,
        classLevels: [
          { className: 'Wizard', level: 2 },
          { className: 'Cleric', level: 1 },
        ],
      } as any;

      const mockMulticlassInfo = {
        totalCasterLevel: 3,
        spellSlots: [4, 2],
        pactMagicSlots: null,
      };
      vi.mocked(spellApi.calculateMulticlassCasterLevel).mockResolvedValue(mockMulticlassInfo as any);

      const result = await getEnhancedSpellcastingInfo(mockCharacter);
      expect(result).not.toBeNull();
      expect(result?.multiclassInfo).toEqual(mockMulticlassInfo);
      expect(result?.spellcastingAbility).toBe('intelligence');
    });
  });

  describe('getSpellValidationRules', () => {
    it('should return is not a spellcasting class message if getSpellcastingInfo returns null', () => {
      const mockClass = { name: 'Fighter' } as any;
      const rules = getSpellValidationRules(mockClass);
      expect(rules).toEqual(['Fighter is not a spellcasting class at 1st level.']);
    });

    it('should return rule list for Wizard class', () => {
      const mockClass = { name: 'Wizard', spellcasting: { ability: 'intelligence' } } as any;
      const rules = getSpellValidationRules(mockClass);

      expect(rules).toContain('Must select exactly 3 cantrips.');
      expect(rules).toContain('Must select exactly 6 spells known.');
      expect(rules).toContain('Uses a spellbook to record spells. Can prepare spells daily.');
      expect(rules).toContain('Can cast ritual spells without expending spell slots.');
      expect(rules).toContain('Spellcasting ability: Intelligence.');
    });

    it('should return rule list for Cleric class', () => {
      const mockClass = { name: 'Cleric', spellcasting: { ability: 'wisdom' } } as any;
      const rules = getSpellValidationRules(mockClass);

      expect(rules).toContain('Must select exactly 3 cantrips.');
      expect(rules).toContain('Can prepare 1 spell (minimum 1).');
      expect(rules).toContain('Can cast ritual spells without expending spell slots.');
      expect(rules).toContain('Spellcasting ability: Wisdom.');
    });

    it('should return rule list for Warlock class', () => {
      const mockClass = { name: 'Warlock', spellcasting: { ability: 'charisma' } } as any;
      const rules = getSpellValidationRules(mockClass);

      expect(rules).toContain('Must select exactly 2 cantrips.');
      expect(rules).toContain('Must select exactly 2 spells known.');
      expect(rules).toContain('Uses Pact Magic. Spell slots recharge on short rest.');
      expect(rules).toContain('Spellcasting ability: Charisma.');
    });

    it('should support singular/plural forms in rules strings', () => {
      // Mock getSpellcastingInfo to return singular values
      vi.mocked(getSpellcastingInfo).mockReturnValueOnce({
        cantripsKnown: 1,
        spellsKnown: 1,
        spellsPrepared: 1,
        hasSpellbook: false,
        isPactMagic: false,
        ritualCasting: false,
        spellcastingAbility: 'wisdom',
      });

      const mockClass = { name: 'CustomClass' } as any;
      const rules = getSpellValidationRules(mockClass);

      expect(rules).toContain('Must select exactly 1 cantrip.');
      expect(rules).toContain('Must select exactly 1 spell known.');
      expect(rules).toContain('Can prepare 1 spell (minimum 1).');
      expect(rules).toContain('Spellcasting ability: Wisdom.');
    });
  });
});
