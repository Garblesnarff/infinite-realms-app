/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  calculateAbilityModifier,
  calculateProficiencyBonus,
  getAbilityModifier,
  getProficiencyBonus,
  isSkillProficient,
  isSaveProficient,
  calculateSkillModifier,
  calculateSaveModifier,
  calculateAttackModifier,
  calculateInitiativeModifier,
  generateDiceFormula,
  calculateRollWithBreakdown,
  parseAbilityName,
  getCharacterStatsForAI,
} from '../characterModifiers';

import type { Equipment } from '@/data/equipmentOptions';
import type { Character } from '@/types/character';


vi.mock('@/lib/logger', () => ({
  default: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('characterModifiers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('calculateAbilityModifier', () => {
    it('should calculate correct modifiers for various scores', () => {
      expect(calculateAbilityModifier(1)).toBe(-5);
      expect(calculateAbilityModifier(5)).toBe(-3);
      expect(calculateAbilityModifier(9)).toBe(-1);
      expect(calculateAbilityModifier(10)).toBe(0);
      expect(calculateAbilityModifier(11)).toBe(0);
      expect(calculateAbilityModifier(12)).toBe(1);
      expect(calculateAbilityModifier(15)).toBe(2);
      expect(calculateAbilityModifier(20)).toBe(5);
      expect(calculateAbilityModifier(30)).toBe(10);
    });
  });

  describe('calculateProficiencyBonus', () => {
    it('should return correct D&D 5e proficiency bonuses based on level', () => {
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
    it('should use pre-calculated modifier if available', () => {
      const character: Partial<Character> = {
        abilityScores: {
          strength: { score: 14, modifier: 3, savingThrow: false },
        } as any,
      };
      expect(getAbilityModifier(character as Character, 'strength')).toBe(3);
    });

    it('should calculate modifier from score if modifier is undefined', () => {
      const character: Partial<Character> = {
        abilityScores: {
          strength: { score: 14 } as any,
        } as any,
      };
      expect(getAbilityModifier(character as Character, 'strength')).toBe(2);
    });

    it('should return 0 if ability score is missing', () => {
      const character: Partial<Character> = {
        abilityScores: {} as any,
      };
      expect(getAbilityModifier(character as Character, 'strength')).toBe(0);
    });
  });

  describe('getProficiencyBonus', () => {
    it('should calculate bonus based on character level', () => {
      const character: Partial<Character> = { level: 9 };
      expect(getProficiencyBonus(character as Character)).toBe(4);
    });

    it('should default to level 1 if level is missing', () => {
      const character: Partial<Character> = {};
      expect(getProficiencyBonus(character as Character)).toBe(2);
    });
  });

  describe('isSkillProficient', () => {
    it('should return true if character has the skill in skillProficiencies', () => {
      const character: Partial<Character> = {
        skillProficiencies: ['Athletics', 'Stealth'],
      };
      expect(isSkillProficient(character as Character, 'athletics')).toBe(true);
      expect(isSkillProficient(character as Character, 'STEALTH')).toBe(true);
    });

    it('should resolve aliases correctly', () => {
      const character: Partial<Character> = {
        skillProficiencies: ['Sleight of Hand', 'Animal Handling'],
      };
      expect(isSkillProficient(character as Character, 'sleight')).toBe(true);
      expect(isSkillProficient(character as Character, 'animal')).toBe(true);
      expect(isSkillProficient(character as Character, 'handle')).toBe(true);
    });

    it('should return false if skill is not in skillProficiencies', () => {
      const character: Partial<Character> = {
        skillProficiencies: ['Athletics'],
      };
      expect(isSkillProficient(character as Character, 'stealth')).toBe(false);
    });

    it('should return false if skillProficiencies is missing', () => {
      const character: Partial<Character> = {};
      expect(isSkillProficient(character as Character, 'athletics')).toBe(false);
    });
  });

  describe('isSaveProficient', () => {
    it('should return true if ability is in savingThrowProficiencies', () => {
      const character: Partial<Character> = {
        savingThrowProficiencies: ['strength'],
      };
      expect(isSaveProficient(character as Character, 'strength')).toBe(true);
      expect(isSaveProficient(character as Character, 'dexterity')).toBe(false);
    });

    it('should fall back to checking the savingThrow flag on abilityScore', () => {
      const character: Partial<Character> = {
        abilityScores: {
          strength: { score: 10, modifier: 0, savingThrow: true },
          dexterity: { score: 10, modifier: 0, savingThrow: false },
        } as any,
      };
      expect(isSaveProficient(character as Character, 'strength')).toBe(true);
      expect(isSaveProficient(character as Character, 'dexterity')).toBe(false);
    });

    it('should return false if both fields are missing', () => {
      const character: Partial<Character> = {};
      expect(isSaveProficient(character as Character, 'strength')).toBe(false);
    });
  });

  describe('calculateSkillModifier', () => {
    it('should return 0 and log warning for unknown skill', async () => {
      const character: Partial<Character> = {};
      const logger = (await import('@/lib/logger')).default;

      const result = calculateSkillModifier(character as Character, 'unknown_skill');

      expect(result).toBe(0);
      expect(logger.warn).toHaveBeenCalledWith('Unknown skill: unknown_skill');
    });

    it('should return ability modifier only if not proficient', () => {
      const character: Partial<Character> = {
        abilityScores: {
          dexterity: { score: 14, modifier: 2, savingThrow: false },
        } as any,
        skillProficiencies: [],
      };
      expect(calculateSkillModifier(character as Character, 'stealth')).toBe(2);
    });

    it('should return ability modifier + proficiency bonus if proficient', () => {
      const character: Partial<Character> = {
        level: 5, // prof bonus: +3
        abilityScores: {
          dexterity: { score: 14, modifier: 2, savingThrow: false },
        } as any,
        skillProficiencies: ['Stealth'],
      };
      expect(calculateSkillModifier(character as Character, 'stealth')).toBe(5);
    });

    it('should return ability modifier + double proficiency bonus if expertise is present', () => {
      const character: Partial<Character> = {
        level: 5, // prof bonus: +3
        abilityScores: {
          dexterity: { score: 14, modifier: 2, savingThrow: false },
        } as any,
        skillProficiencies: ['Stealth'],
        expertiseProficiencies: ['Stealth'],
      };
      // 2 + 3 * 2 = 8
      expect(calculateSkillModifier(character as Character, 'stealth')).toBe(8);
    });

    it('should correctly apply expertise even when using a skill alias', () => {
      const character: Partial<Character> = {
        level: 1, // prof bonus: +2
        abilityScores: {
          dexterity: { score: 16, modifier: 3, savingThrow: false },
        } as any,
        skillProficiencies: ['Sleight of Hand'],
        expertiseProficiencies: ['Sleight of Hand'],
      };
      // Alias "sleight" should resolve to "sleight of hand" and trigger both proficiency and expertise.
      // 3 + 2 * 2 = 7
      expect(calculateSkillModifier(character as Character, 'sleight')).toBe(7);
    });
  });

  describe('calculateSaveModifier', () => {
    it('should return ability modifier only if not proficient in save', () => {
      const character: Partial<Character> = {
        abilityScores: {
          strength: { score: 14, modifier: 2, savingThrow: false },
        } as any,
      };
      expect(calculateSaveModifier(character as Character, 'strength')).toBe(2);
    });

    it('should return ability modifier + proficiency bonus if proficient in save', () => {
      const character: Partial<Character> = {
        level: 1, // prof bonus: +2
        abilityScores: {
          strength: { score: 14, modifier: 2, savingThrow: true },
        } as any,
      };
      expect(calculateSaveModifier(character as Character, 'strength')).toBe(4);
    });
  });

  describe('calculateAttackModifier', () => {
    it('should default to strength for unarmed strikes or null weapon', () => {
      const character: Partial<Character> = {
        level: 1, // prof bonus: +2
        abilityScores: {
          strength: { score: 14, modifier: 2, savingThrow: false },
          dexterity: { score: 10, modifier: 0, savingThrow: false },
        } as any,
      };
      expect(calculateAttackModifier(character as Character)).toBe(4);
      expect(calculateAttackModifier(character as Character, null)).toBe(4);
    });

    it('should use dex for ranged weapons', () => {
      const character: Partial<Character> = {
        level: 1, // prof bonus: +2
        abilityScores: {
          strength: { score: 14, modifier: 2, savingThrow: false },
          dexterity: { score: 16, modifier: 3, savingThrow: false },
        } as any,
      };
      const bow: Partial<Equipment> = {
        range: '80/320',
      };
      // 3 (DEX) + 2 (Prof) = 5
      expect(calculateAttackModifier(character as Character, bow as Equipment)).toBe(5);
    });

    it('should use strength for non-finesse melee weapons', () => {
      const character: Partial<Character> = {
        level: 1, // prof bonus: +2
        abilityScores: {
          strength: { score: 16, modifier: 3, savingThrow: false },
          dexterity: { score: 10, modifier: 0, savingThrow: false },
        } as any,
      };
      const greatsword: Partial<Equipment> = {
        weaponProperties: { finesse: false },
      };
      // 3 (STR) + 2 (Prof) = 5
      expect(calculateAttackModifier(character as Character, greatsword as Equipment)).toBe(5);
    });

    it('should use higher of strength and dexterity for finesse weapons', () => {
      const greatDexCharacter: Partial<Character> = {
        level: 1, // prof bonus: +2
        abilityScores: {
          strength: { score: 10, modifier: 0, savingThrow: false },
          dexterity: { score: 16, modifier: 3, savingThrow: false },
        } as any,
      };
      const greatStrCharacter: Partial<Character> = {
        level: 1, // prof bonus: +2
        abilityScores: {
          strength: { score: 16, modifier: 3, savingThrow: false },
          dexterity: { score: 10, modifier: 0, savingThrow: false },
        } as any,
      };
      const rapier: Partial<Equipment> = {
        weaponProperties: { finesse: true },
      };

      // DEX is higher: 3 (DEX) + 2 (Prof) = 5
      expect(calculateAttackModifier(greatDexCharacter as Character, rapier as Equipment)).toBe(5);
      // STR is higher: 3 (STR) + 2 (Prof) = 5
      expect(calculateAttackModifier(greatStrCharacter as Character, rapier as Equipment)).toBe(5);
    });
  });

  describe('calculateInitiativeModifier', () => {
    it('should return dexterity modifier', () => {
      const character: Partial<Character> = {
        abilityScores: {
          dexterity: { score: 16, modifier: 3, savingThrow: false },
        } as any,
      };
      expect(calculateInitiativeModifier(character as Character)).toBe(3);
    });
  });

  describe('generateDiceFormula', () => {
    it('should generate correctly formatted formulas', () => {
      expect(generateDiceFormula(20, 1, 0)).toBe('1d20');
      expect(generateDiceFormula(20, 1, 5)).toBe('1d20+5');
      expect(generateDiceFormula(6, 3, -2)).toBe('3d6-2');
    });
  });

  describe('calculateRollWithBreakdown', () => {
    const character: Partial<Character> = {
      level: 1, // prof bonus: +2
      abilityScores: {
        strength: { score: 14, modifier: 2, savingThrow: true },
        dexterity: { score: 10, modifier: 0, savingThrow: false },
        intelligence: { score: 8, modifier: -1, savingThrow: false },
      } as any,
      skillProficiencies: ['Sleight of Hand'],
      expertiseProficiencies: ['Sleight of Hand'],
      toolProficiencies: ['Thieves Tools'],
    };

    it('should calculate breakdown for attack roll', () => {
      const calculation = calculateRollWithBreakdown(character as Character, 'attack', 'strength');
      expect(calculation.formula).toBe('1d20+4');
      expect(calculation.totalModifier).toBe(4);
      expect(calculation.abilityModifier).toBe(2);
      expect(calculation.proficiencyBonus).toBe(2);
      expect(calculation.breakdown).toEqual(['1d20', 'STR +2', 'Prof +2']);
    });

    it('should calculate breakdown for save roll', () => {
      const calculation = calculateRollWithBreakdown(character as Character, 'save', 'strength');
      expect(calculation.formula).toBe('1d20+4');
      expect(calculation.totalModifier).toBe(4);
      expect(calculation.breakdown).toEqual(['1d20', 'STR +2', 'Prof +2']);
    });

    it('should throw error for save roll if ability is missing', () => {
      expect(() => calculateRollWithBreakdown(character as Character, 'save')).toThrow(
        'Ability required for saving throw',
      );
    });

    it('should calculate breakdown for check roll without tool proficiency', () => {
      const calculation = calculateRollWithBreakdown(character as Character, 'check', 'strength');
      expect(calculation.formula).toBe('1d20+2');
      expect(calculation.totalModifier).toBe(2);
      expect(calculation.breakdown).toEqual(['1d20', 'STR +2']);
    });

    it('should calculate breakdown for check roll with tool proficiency', () => {
      const calculation = calculateRollWithBreakdown(
        character as Character,
        'check',
        'dexterity',
        'Thieves Tools',
      );
      expect(calculation.formula).toBe('1d20+2');
      expect(calculation.totalModifier).toBe(2);
      expect(calculation.proficiencyBonus).toBe(2);
      expect(calculation.breakdown).toEqual(['1d20', 'DEX +0', 'Thieves Tools Prof +2']);
    });

    it('should throw error for check roll if ability is missing', () => {
      expect(() => calculateRollWithBreakdown(character as Character, 'check')).toThrow(
        'Ability required for ability check',
      );
    });

    it('should calculate breakdown for skill roll', () => {
      const calculation = calculateRollWithBreakdown(
        character as Character,
        'skill',
        undefined,
        'Sleight of Hand',
      );
      // DEX (0) + 2 (Prof) * 2 (Expertise) = 4
      expect(calculation.formula).toBe('1d20+4');
      expect(calculation.totalModifier).toBe(4);
      expect(calculation.breakdown).toEqual(['1d20', 'DEX +0', 'Prof +4']);
    });

    it('should calculate breakdown for skill roll with alias and expertise', () => {
      const calculation = calculateRollWithBreakdown(
        character as Character,
        'skill',
        undefined,
        'sleight',
      );
      // Alias "sleight" should resolve and apply expertise correctly.
      // DEX (0) + 2 (Prof) * 2 (Expertise) = 4
      expect(calculation.formula).toBe('1d20+4');
      expect(calculation.totalModifier).toBe(4);
      expect(calculation.breakdown).toEqual(['1d20', 'DEX +0', 'Prof +4']);
    });

    it('should throw error for skill roll if skillName is missing', () => {
      expect(() => calculateRollWithBreakdown(character as Character, 'skill')).toThrow(
        'Skill name required for skill check',
      );
    });

    it('should throw error for skill roll if skill is unknown', () => {
      expect(() =>
        calculateRollWithBreakdown(character as Character, 'skill', undefined, 'unknown_skill'),
      ).toThrow('Unknown skill: unknown_skill');
    });

    it('should calculate breakdown for initiative roll', () => {
      const calculation = calculateRollWithBreakdown(character as Character, 'initiative');
      expect(calculation.formula).toBe('1d20');
      expect(calculation.totalModifier).toBe(0);
      expect(calculation.breakdown).toEqual(['1d20', 'DEX +0']);
    });
  });

  describe('parseAbilityName', () => {
    it('should correctly parse standard D&D ability formats', () => {
      expect(parseAbilityName('str')).toBe('strength');
      expect(parseAbilityName('STR   ')).toBe('strength');
      expect(parseAbilityName('strength')).toBe('strength');
      expect(parseAbilityName('dex')).toBe('dexterity');
      expect(parseAbilityName('DEX')).toBe('dexterity');
      expect(parseAbilityName('dexterity')).toBe('dexterity');
      expect(parseAbilityName('con')).toBe('constitution');
      expect(parseAbilityName('constitution')).toBe('constitution');
      expect(parseAbilityName('int')).toBe('intelligence');
      expect(parseAbilityName('intelligence')).toBe('intelligence');
      expect(parseAbilityName('wis')).toBe('wisdom');
      expect(parseAbilityName('wisdom')).toBe('wisdom');
      expect(parseAbilityName('cha')).toBe('charisma');
      expect(parseAbilityName('charisma')).toBe('charisma');
    });

    it('should return null for unknown strings', () => {
      expect(parseAbilityName('invalid')).toBeNull();
    });
  });

  describe('getCharacterStatsForAI', () => {
    it('should return a detailed summary of the character stats', () => {
      const character: Partial<Character> = {
        level: 3,
        race: { name: 'Elf' } as any,
        class: { name: 'Ranger' } as any,
        abilityScores: {
          strength: { score: 10, modifier: 0, savingThrow: false },
          dexterity: { score: 16, modifier: 3, savingThrow: false },
          constitution: { score: 14, modifier: 2, savingThrow: false },
          intelligence: { score: 8, modifier: -1, savingThrow: false },
          wisdom: { score: 12, modifier: 1, savingThrow: false },
          charisma: { score: 13, modifier: 1, savingThrow: false },
        },
      };

      const result = getCharacterStatsForAI(character as Character);

      expect(result).toContain('Level 3 Elf Ranger');
      expect(result).toContain('STR 10(+0)');
      expect(result).toContain('DEX 16(+3)');
      expect(result).toContain('INT 8(-1)');
      expect(result).toContain('Proficiency Bonus: +2');
    });

    it('should handle missing race and class names gracefully', () => {
      const character: Partial<Character> = {
        level: 1,
        abilityScores: {
          strength: { score: 10, modifier: 0, savingThrow: false },
          dexterity: { score: 10, modifier: 0, savingThrow: false },
          constitution: { score: 10, modifier: 0, savingThrow: false },
          intelligence: { score: 10, modifier: 0, savingThrow: false },
          wisdom: { score: 10, modifier: 0, savingThrow: false },
          charisma: { score: 10, modifier: 0, savingThrow: false },
        },
      };

      const result = getCharacterStatsForAI(character as Character);

      expect(result).toContain('Level 1 Unknown Unknown');
    });

    it('should return warning message if abilityScores are missing', () => {
      const character: Partial<Character> = {};
      const result = getCharacterStatsForAI(character as Character);
      expect(result).toBe('No ability scores available');
    });
  });
});
