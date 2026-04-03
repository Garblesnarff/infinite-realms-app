/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { describe, it, expect, vi } from 'vitest';

import {
  calculateAbilityModifier,
  calculateProficiencyBonus,
  getAbilityModifier,
  isSkillProficient,
  isSaveProficient,
  calculateSkillModifier,
  calculateSaveModifier,
  calculateAttackModifier,
  calculateRollWithBreakdown,
  parseAbilityName,
  getCharacterStatsForAI,
} from '../characterModifiers';

import type { Character } from '@/types/character';

// Mock logger
vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('characterModifiers', () => {
  const mockCharacter: Character = {
    id: 'char-1',
    name: 'Test Character',
    level: 1,
    abilityScores: {
      strength: { score: 14, modifier: 2, savingThrow: true },
      dexterity: { score: 12, modifier: 1, savingThrow: false },
      constitution: { score: 10, modifier: 0, savingThrow: false },
      intelligence: { score: 8, modifier: -1, savingThrow: false },
      wisdom: { score: 16, modifier: 3, savingThrow: true },
      charisma: { score: 13, modifier: 1, savingThrow: false },
    },
    skillProficiencies: ['Athletics', 'Perception', 'Stealth'],
    savingThrowProficiencies: ['strength', 'wisdom'],
  };

  describe('calculateAbilityModifier', () => {
    it('should calculate correct modifiers for various scores', () => {
      expect(calculateAbilityModifier(1)).toBe(-5);
      expect(calculateAbilityModifier(8)).toBe(-1);
      expect(calculateAbilityModifier(9)).toBe(-1);
      expect(calculateAbilityModifier(10)).toBe(0);
      expect(calculateAbilityModifier(11)).toBe(0);
      expect(calculateAbilityModifier(12)).toBe(1);
      expect(calculateAbilityModifier(13)).toBe(1);
      expect(calculateAbilityModifier(14)).toBe(2);
      expect(calculateAbilityModifier(15)).toBe(2);
      expect(calculateAbilityModifier(20)).toBe(5);
      expect(calculateAbilityModifier(30)).toBe(10);
    });
  });

  describe('calculateProficiencyBonus', () => {
    it('should calculate correct proficiency bonus for all levels', () => {
      expect(calculateProficiencyBonus(1)).toBe(2);
      expect(calculateProficiencyBonus(4)).toBe(2);
      expect(calculateProficiencyBonus(5)).toBe(3);
      expect(calculateProficiencyBonus(8)).toBe(3);
      expect(calculateProficiencyBonus(9)).toBe(4);
      expect(calculateProficiencyBonus(12)).toBe(4);
      expect(calculateProficiencyBonus(13)).toBe(5);
      expect(calculateProficiencyBonus(16)).toBe(5);
      expect(calculateProficiencyBonus(17)).toBe(6);
      expect(calculateProficiencyBonus(20)).toBe(6);
    });
  });

  describe('getAbilityModifier', () => {
    it('should return the pre-calculated modifier if available', () => {
      const char = {
        abilityScores: {
          strength: { score: 14, modifier: 3 }, // Overridden modifier
        },
      } as any;
      expect(getAbilityModifier(char, 'strength')).toBe(3);
    });

    it('should calculate modifier if not pre-calculated', () => {
      const char = {
        abilityScores: {
          strength: { score: 14 },
        },
      } as any;
      expect(getAbilityModifier(char, 'strength')).toBe(2);
    });

    it('should return 0 if ability score is missing', () => {
      const char = { abilityScores: {} } as any;
      expect(getAbilityModifier(char, 'strength')).toBe(0);
    });
  });

  describe('isSkillProficient', () => {
    it('should return true if character has skill proficiency', () => {
      expect(isSkillProficient(mockCharacter, 'Athletics')).toBe(true);
      expect(isSkillProficient(mockCharacter, 'athletics')).toBe(true);
      expect(isSkillProficient(mockCharacter, 'Stealth')).toBe(true);
    });

    it('should handle skill aliases', () => {
      expect(isSkillProficient(mockCharacter, 'Animal')).toBe(false); // Animal Handling not in list
      const charWithAnimal = { ...mockCharacter, skillProficiencies: ['Animal Handling'] };
      expect(isSkillProficient(charWithAnimal, 'Animal')).toBe(true);
      expect(isSkillProficient(charWithAnimal, 'handle')).toBe(true);
      expect(isSkillProficient(charWithAnimal, 'sleight')).toBe(false);
    });

    it('should return false if character has no skill proficiencies', () => {
      const char = { ...mockCharacter, skillProficiencies: undefined };
      expect(isSkillProficient(char, 'Athletics')).toBe(false);
    });
  });

  describe('isSaveProficient', () => {
    it('should return true if in savingThrowProficiencies', () => {
      expect(isSaveProficient(mockCharacter, 'strength')).toBe(true);
      expect(isSaveProficient(mockCharacter, 'dexterity')).toBe(false);
    });

    it('should use fallback if savingThrowProficiencies is missing', () => {
      const char = {
        abilityScores: {
          strength: { score: 14, savingThrow: true },
          dexterity: { score: 12, savingThrow: false },
        },
      } as any;
      expect(isSaveProficient(char, 'strength')).toBe(true);
      expect(isSaveProficient(char, 'dexterity')).toBe(false);
      expect(isSaveProficient(char, 'wisdom')).toBe(false);
    });
  });

  describe('calculateSkillModifier', () => {
    it('should calculate correct skill modifier including proficiency', () => {
      // Athletics: Str(2) + Prof(2) = 4
      expect(calculateSkillModifier(mockCharacter, 'Athletics')).toBe(4);
      // Stealth: Dex(1) + Prof(2) = 3
      expect(calculateSkillModifier(mockCharacter, 'Stealth')).toBe(3);
      // Perception: Wis(3) + Prof(2) = 5
      expect(calculateSkillModifier(mockCharacter, 'Perception')).toBe(5);
    });

    it('should calculate correct skill modifier without proficiency', () => {
      // Arcana: Int(-1) + No Prof(0) = -1
      expect(calculateSkillModifier(mockCharacter, 'Arcana')).toBe(-1);
    });

    it('should return 0 and log warning for unknown skill', () => {
      expect(calculateSkillModifier(mockCharacter, 'Unknown')).toBe(0);
    });
  });

  describe('calculateSaveModifier', () => {
    it('should calculate correct save modifier', () => {
      expect(calculateSaveModifier(mockCharacter, 'strength')).toBe(4);
      expect(calculateSaveModifier(mockCharacter, 'intelligence')).toBe(-1);
    });
  });

  describe('calculateAttackModifier', () => {
    it('should default to Strength for unarmed/no weapon', () => {
      // Str(2) + Prof(2) = 4
      expect(calculateAttackModifier(mockCharacter)).toBe(4);
      expect(calculateAttackModifier(mockCharacter, null)).toBe(4);
    });

    it('should use Strength for non-finesse melee weapons', () => {
      const longsword = { weaponProperties: { finesse: false } } as any;
      expect(calculateAttackModifier(mockCharacter, longsword)).toBe(4);
    });

    it('should use Dexterity for ranged weapons', () => {
      const longbow = { range: '150/600' } as any;
      // Dex(1) + Prof(2) = 3
      expect(calculateAttackModifier(mockCharacter, longbow)).toBe(3);
    });

    it('should use higher of Str/Dex for finesse weapons', () => {
      const rapier = { weaponProperties: { finesse: true } } as any;
      // Str(2) is higher than Dex(1), so uses Str
      expect(calculateAttackModifier(mockCharacter, rapier)).toBe(4);

      const highDexChar = {
        ...mockCharacter,
        abilityScores: {
          ...mockCharacter.abilityScores,
          dexterity: { score: 18, modifier: 4 },
        },
      } as any;
      // Dex(4) is higher than Str(2), so uses Dex
      expect(calculateAttackModifier(highDexChar, rapier)).toBe(6); // Dex(4) + Prof(2)
    });
  });

  describe('calculateRollWithBreakdown', () => {
    it('should handle attack roll breakdown', () => {
      const result = calculateRollWithBreakdown(mockCharacter, 'attack', 'strength');
      expect(result.formula).toBe('1d20+4');
      expect(result.totalModifier).toBe(4);
      expect(result.breakdown).toContain('STR +2');
      expect(result.breakdown).toContain('Prof +2');
    });

    it('should handle save roll breakdown', () => {
      const result = calculateRollWithBreakdown(mockCharacter, 'save', 'strength');
      expect(result.isProficient).toBe(true);
      expect(result.formula).toBe('1d20+4');
      expect(result.breakdown).toContain('STR +2');
      expect(result.breakdown).toContain('Prof +2');

      const resultInt = calculateRollWithBreakdown(mockCharacter, 'save', 'intelligence');
      expect(resultInt.isProficient).toBe(false);
      expect(resultInt.formula).toBe('1d20-1');
      expect(resultInt.breakdown).toContain('INT -1');
      expect(resultInt.breakdown).not.toContain('Prof +2');
    });

    it('should handle check roll breakdown', () => {
      const result = calculateRollWithBreakdown(mockCharacter, 'check', 'wisdom');
      expect(result.formula).toBe('1d20+3');
      expect(result.breakdown).toContain('WIS +3');
    });

    it('should handle skill roll breakdown', () => {
      const result = calculateRollWithBreakdown(mockCharacter, 'skill', undefined, 'Stealth');
      expect(result.formula).toBe('1d20+3');
      expect(result.breakdown).toContain('DEX +1');
      expect(result.breakdown).toContain('Prof +2');
    });

    it('should throw error for save roll without ability', () => {
      expect(() => calculateRollWithBreakdown(mockCharacter, 'save')).toThrow();
    });

    it('should throw error for check roll without ability', () => {
      expect(() => calculateRollWithBreakdown(mockCharacter, 'check')).toThrow();
    });

    it('should throw error for skill roll without skill name', () => {
      expect(() => calculateRollWithBreakdown(mockCharacter, 'skill')).toThrow();
    });

    it('should throw error for unknown skill in breakdown', () => {
      expect(() =>
        calculateRollWithBreakdown(mockCharacter, 'skill', undefined, 'UnknownSkill'),
      ).toThrow();
    });

    it('should handle aliased skills (Animal Handling)', () => {
      // "Animal" is an alias for "Animal Handling", which uses Wisdom
      // Wisdom modifier is 3. Proficiency is 2 (but character not proficient in Animal Handling)
      const result = calculateRollWithBreakdown(mockCharacter, 'skill', undefined, 'Animal');
      expect(result.ability).toBe('wisdom');
      expect(result.formula).toBe('1d20+3');
    });

    it('should handle initiative breakdown', () => {
      const result = calculateRollWithBreakdown(mockCharacter, 'initiative');
      expect(result.formula).toBe('1d20+1');
      expect(result.breakdown).toContain('DEX +1');
    });
  });

  describe('parseAbilityName', () => {
    it('should parse various ability name formats', () => {
      expect(parseAbilityName('STR')).toBe('strength');
      expect(parseAbilityName('  Dexterity  ')).toBe('dexterity');
      expect(parseAbilityName('con')).toBe('constitution');
      expect(parseAbilityName('Invalid')).toBe(null);
    });
  });

  describe('getCharacterStatsForAI', () => {
    it('should return a formatted summary', () => {
      const summary = getCharacterStatsForAI(mockCharacter);
      expect(summary).toContain('Level 1');
      expect(summary).toContain('STR 14(+2)');
      expect(summary).toContain('Proficiency Bonus: +2');
    });
  });
});
