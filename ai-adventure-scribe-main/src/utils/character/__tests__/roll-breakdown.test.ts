/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { describe, it, expect } from 'vitest';

import {
  generateDiceFormula,
  calculateRollWithBreakdown,
  getCharacterStatsForAI,
} from '../roll-breakdown';


describe('roll-breakdown', () => {
  describe('generateDiceFormula', () => {
    it('should generate formula with positive modifiers', () => {
      expect(generateDiceFormula(20, 1, 5)).toBe('1d20+5');
      expect(generateDiceFormula(6, 3, 2)).toBe('3d6+2');
    });

    it('should generate formula with negative modifiers', () => {
      expect(generateDiceFormula(20, 1, -3)).toBe('1d20-3');
      expect(generateDiceFormula(8, 2, -1)).toBe('2d8-1');
    });

    it('should generate formula without modifier if modifier is 0', () => {
      expect(generateDiceFormula(20, 1, 0)).toBe('1d20');
      expect(generateDiceFormula(12, 2, 0)).toBe('2d12');
    });

    it('should use default arguments if not specified', () => {
      expect(generateDiceFormula()).toBe('1d20');
    });
  });

  describe('calculateRollWithBreakdown', () => {
    const mockCharacter: any = {
      level: 5,
      abilityScores: {
        strength: { score: 16, modifier: 3 },
        dexterity: { score: 14, modifier: 2 },
        constitution: { score: 12, modifier: 1 },
        intelligence: { score: 8, modifier: -1 },
        wisdom: { score: 10, modifier: 0 },
        charisma: { score: 15, modifier: 2 },
      },
      savingThrowProficiencies: ['strength', 'constitution'],
      skillProficiencies: ['athletics', 'perception'],
      toolProficiencies: ['Thieves\' Tools'],
      expertiseProficiencies: ['athletics'],
    };

    describe('attack rolls', () => {
      it('should calculate attack roll defaulting to strength', () => {
        const result = calculateRollWithBreakdown(mockCharacter, 'attack');
        expect(result.ability).toBe('strength');
        expect(result.abilityModifier).toBe(3);
        expect(result.proficiencyBonus).toBe(3); // Level 5 has +3 prof
        expect(result.totalModifier).toBe(6);
        expect(result.formula).toBe('1d20+6');
        expect(result.isProficient).toBe(true);
        expect(result.breakdown).toEqual(['1d20', 'STR +3', 'Prof +3']);
      });

      it('should calculate attack roll with specified ability (e.g. dexterity)', () => {
        const result = calculateRollWithBreakdown(mockCharacter, 'attack', 'dexterity');
        expect(result.ability).toBe('dexterity');
        expect(result.abilityModifier).toBe(2);
        expect(result.totalModifier).toBe(5);
        expect(result.formula).toBe('1d20+5');
        expect(result.breakdown).toEqual(['1d20', 'DEX +2', 'Prof +3']);
      });
    });

    describe('saving throws', () => {
      it('should throw error if ability is not provided', () => {
        expect(() => calculateRollWithBreakdown(mockCharacter, 'save')).toThrow(
          'Ability required for saving throw',
        );
      });

      it('should calculate proficient saving throw', () => {
        const result = calculateRollWithBreakdown(mockCharacter, 'save', 'constitution');
        expect(result.ability).toBe('constitution');
        expect(result.abilityModifier).toBe(1);
        expect(result.proficiencyBonus).toBe(3);
        expect(result.totalModifier).toBe(4);
        expect(result.isProficient).toBe(true);
        expect(result.breakdown).toEqual(['1d20', 'CON +1', 'Prof +3']);
      });

      it('should calculate non-proficient saving throw', () => {
        const result = calculateRollWithBreakdown(mockCharacter, 'save', 'intelligence');
        expect(result.ability).toBe('intelligence');
        expect(result.abilityModifier).toBe(-1);
        expect(result.proficiencyBonus).toBe(0);
        expect(result.totalModifier).toBe(-1);
        expect(result.isProficient).toBe(false);
        expect(result.breakdown).toEqual(['1d20', 'INT -1']);
      });
    });

    describe('ability checks', () => {
      it('should throw error if ability is not provided', () => {
        expect(() => calculateRollWithBreakdown(mockCharacter, 'check')).toThrow(
          'Ability required for ability check',
        );
      });

      it('should calculate non-proficient ability check', () => {
        const result = calculateRollWithBreakdown(mockCharacter, 'check', 'wisdom');
        expect(result.ability).toBe('wisdom');
        expect(result.abilityModifier).toBe(0);
        expect(result.proficiencyBonus).toBe(0);
        expect(result.totalModifier).toBe(0);
        expect(result.isProficient).toBe(false);
        expect(result.breakdown).toEqual(['1d20', 'WIS +0']);
      });

      it('should calculate ability check with tool proficiency', () => {
        const result = calculateRollWithBreakdown(mockCharacter, 'check', 'dexterity', 'Thieves\' Tools');
        expect(result.ability).toBe('dexterity');
        expect(result.abilityModifier).toBe(2);
        expect(result.proficiencyBonus).toBe(3);
        expect(result.totalModifier).toBe(5);
        expect(result.isProficient).toBe(true);
        expect(result.breakdown).toEqual(['1d20', 'DEX +2', 'Thieves\' Tools Prof +3']);
      });
    });

    describe('skill checks', () => {
      it('should throw error if skill name is not provided', () => {
        expect(() => calculateRollWithBreakdown(mockCharacter, 'skill')).toThrow(
          'Skill name required for skill check',
        );
      });

      it('should throw error for unknown skill', () => {
        expect(() => calculateRollWithBreakdown(mockCharacter, 'skill', undefined, 'cooking')).toThrow(
          'Unknown skill: cooking',
        );
      });

      it('should calculate skill check with expertise', () => {
        const result = calculateRollWithBreakdown(mockCharacter, 'skill', undefined, 'athletics');
        expect(result.ability).toBe('strength');
        expect(result.abilityModifier).toBe(3);
        expect(result.proficiencyBonus).toBe(6); // Double prof for expertise: 3 * 2 = 6
        expect(result.totalModifier).toBe(9);
        expect(result.isProficient).toBe(true);
        expect(result.breakdown).toEqual(['1d20', 'STR +3', 'Prof +6']);
      });

      it('should calculate skill check with standard proficiency', () => {
        const result = calculateRollWithBreakdown(mockCharacter, 'skill', undefined, 'perception');
        expect(result.ability).toBe('wisdom');
        expect(result.abilityModifier).toBe(0);
        expect(result.proficiencyBonus).toBe(3);
        expect(result.totalModifier).toBe(3);
        expect(result.isProficient).toBe(true);
        expect(result.breakdown).toEqual(['1d20', 'WIS +0', 'Prof +3']);
      });

      it('should calculate non-proficient skill check', () => {
        const result = calculateRollWithBreakdown(mockCharacter, 'skill', undefined, 'stealth');
        expect(result.ability).toBe('dexterity');
        expect(result.abilityModifier).toBe(2);
        expect(result.proficiencyBonus).toBe(0);
        expect(result.totalModifier).toBe(2);
        expect(result.isProficient).toBe(false);
        expect(result.breakdown).toEqual(['1d20', 'DEX +2']);
      });

      it('should handle skill check aliases (e.g. sleight)', () => {
        const characterWithSleight: any = {
          ...mockCharacter,
          skillProficiencies: ['sleight of hand'],
        };
        const result = calculateRollWithBreakdown(characterWithSleight, 'skill', undefined, 'sleight');
        expect(result.ability).toBe('dexterity');
        expect(result.isProficient).toBe(true);
      });
    });

    describe('initiative checks', () => {
      it('should calculate initiative check based on dexterity', () => {
        const result = calculateRollWithBreakdown(mockCharacter, 'initiative');
        expect(result.ability).toBe('dexterity');
        expect(result.abilityModifier).toBe(2);
        expect(result.proficiencyBonus).toBe(0);
        expect(result.totalModifier).toBe(2);
        expect(result.formula).toBe('1d20+2');
        expect(result.breakdown).toEqual(['1d20', 'DEX +2']);
      });
    });
  });

  describe('getCharacterStatsForAI', () => {
    it('should return warning string if character lacks abilityScores', () => {
      const character: any = {};
      expect(getCharacterStatsForAI(character)).toBe('No ability scores available');
    });

    it('should return complete summary for AI context', () => {
      const character: any = {
        level: 4,
        race: { name: 'Dwarf' },
        class: { name: 'Cleric' },
        abilityScores: {
          strength: { score: 14, modifier: 2 },
          dexterity: { score: 10, modifier: 0 },
          constitution: { score: 16, modifier: 3 },
          intelligence: { score: 8, modifier: -1 },
          wisdom: { score: 15, modifier: 2 },
          charisma: { score: 12, modifier: 1 },
        },
      };

      const result = getCharacterStatsForAI(character);
      expect(result).toContain('Level 4 Dwarf Cleric');
      expect(result).toContain('Ability Scores: STR 14(+2), DEX 10(+0), CON 16(+3), INT 8(-1), WIS 15(+2), CHA 12(+1)');
      expect(result).toContain('Proficiency Bonus: +2');
    });

    it('should fallback to Unknown for race and class if absent', () => {
      const character: any = {
        level: 1,
        abilityScores: {
          strength: { score: 10, modifier: 0 },
          dexterity: { score: 10, modifier: 0 },
          constitution: { score: 10, modifier: 0 },
          intelligence: { score: 10, modifier: 0 },
          wisdom: { score: 10, modifier: 0 },
          charisma: { score: 10, modifier: 0 },
        },
      };

      const result = getCharacterStatsForAI(character);
      expect(result).toContain('Level 1 Unknown Unknown');
    });
  });
});
