/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect } from 'vitest';

import {
  calculateAbilityModifier,
  calculateProficiencyBonus,
  getAbilityModifier,
  getProficiencyBonus,
  isSkillProficient,
  isSaveProficient,
  SKILL_ABILITIES,
  SKILL_ALIASES,
} from '../basic-modifiers';

describe('basic-modifiers', () => {
  describe('SKILL_ABILITIES', () => {
    it('should map skills to correct ability scores', () => {
      expect(SKILL_ABILITIES.athletics).toBe('strength');
      expect(SKILL_ABILITIES.stealth).toBe('dexterity');
      expect(SKILL_ABILITIES.history).toBe('intelligence');
      expect(SKILL_ABILITIES.perception).toBe('wisdom');
      expect(SKILL_ABILITIES.persuasion).toBe('charisma');
    });
  });

  describe('SKILL_ALIASES', () => {
    it('should define expected skill aliases', () => {
      expect(SKILL_ALIASES.sleight).toBe('sleight of hand');
      expect(SKILL_ALIASES.animal).toBe('animal handling');
    });
  });

  describe('calculateAbilityModifier', () => {
    it('should correctly calculate modifiers from scores', () => {
      expect(calculateAbilityModifier(1)).toBe(-5);
      expect(calculateAbilityModifier(3)).toBe(-4);
      expect(calculateAbilityModifier(5)).toBe(-3);
      expect(calculateAbilityModifier(9)).toBe(-1);
      expect(calculateAbilityModifier(10)).toBe(0);
      expect(calculateAbilityModifier(11)).toBe(0);
      expect(calculateAbilityModifier(12)).toBe(1);
      expect(calculateAbilityModifier(13)).toBe(1);
      expect(calculateAbilityModifier(14)).toBe(2);
      expect(calculateAbilityModifier(20)).toBe(5);
      expect(calculateAbilityModifier(30)).toBe(10);
    });
  });

  describe('calculateProficiencyBonus', () => {
    it('should map levels to correct D&D 5e proficiency bonus', () => {
      expect(calculateProficiencyBonus(1)).toBe(2);
      expect(calculateProficiencyBonus(4)).toBe(2);
      expect(calculateProficiencyBonus(5)).toBe(3);
      expect(calculateProficiencyBonus(9)).toBe(4);
      expect(calculateProficiencyBonus(13)).toBe(5);
      expect(calculateProficiencyBonus(17)).toBe(6);
      expect(calculateProficiencyBonus(20)).toBe(6);
    });
  });

  describe('getAbilityModifier', () => {
    it('should return pre-calculated modifier if available', () => {
      const character: any = {
        abilityScores: {
          strength: { score: 14, modifier: 3 }, // non-standard for testing
        },
      };
      expect(getAbilityModifier(character, 'strength')).toBe(3);
    });

    it('should calculate modifier from score if modifier is not provided', () => {
      const character: any = {
        abilityScores: {
          strength: { score: 14 },
        },
      };
      expect(getAbilityModifier(character, 'strength')).toBe(2);
    });

    it('should return 0 if abilityScore is not present', () => {
      const character: any = {
        abilityScores: {},
      };
      expect(getAbilityModifier(character, 'strength')).toBe(0);
    });

    it('should return 0 if abilityScores object is entirely missing', () => {
      const character: any = {};
      expect(getAbilityModifier(character, 'strength')).toBe(0);
    });
  });

  describe('getProficiencyBonus', () => {
    it('should return correct bonus based on character level', () => {
      const character1: any = { level: 5 };
      expect(getProficiencyBonus(character1)).toBe(3);

      const character2: any = { level: 12 };
      expect(getProficiencyBonus(character2)).toBe(4);
    });

    it('should default to level 1 if level is undefined or null', () => {
      const character: any = {};
      expect(getProficiencyBonus(character)).toBe(2);
    });
  });

  describe('isSkillProficient', () => {
    it('should return true for exactly matching proficient skills', () => {
      const character: any = {
        skillProficiencies: ['Athletics', 'Perception'],
      };
      expect(isSkillProficient(character, 'athletics')).toBe(true);
      expect(isSkillProficient(character, 'Perception')).toBe(true);
    });

    it('should support skill aliases and normalize them', () => {
      const character: any = {
        skillProficiencies: ['Sleight of Hand', 'Animal Handling'],
      };
      expect(isSkillProficient(character, 'sleight')).toBe(true);
      expect(isSkillProficient(character, 'sleight of hand')).toBe(true);
      expect(isSkillProficient(character, 'animal')).toBe(true);
      expect(isSkillProficient(character, 'handle')).toBe(true);
    });

    it('should return false for non-proficient skills', () => {
      const character: any = {
        skillProficiencies: ['Athletics'],
      };
      expect(isSkillProficient(character, 'stealth')).toBe(false);
    });

    it('should return false if skillProficiencies is missing', () => {
      const character: any = {};
      expect(isSkillProficient(character, 'athletics')).toBe(false);
    });
  });

  describe('isSaveProficient', () => {
    it('should return true if ability is in savingThrowProficiencies list', () => {
      const character: any = {
        savingThrowProficiencies: ['strength', 'constitution'],
      };
      expect(isSaveProficient(character, 'strength')).toBe(true);
      expect(isSaveProficient(character, 'dexterity')).toBe(false);
    });

    it('should fall back to abilityScores savingThrow flag if list is absent', () => {
      const character: any = {
        abilityScores: {
          strength: { score: 10, savingThrow: true },
          dexterity: { score: 12, savingThrow: false },
        },
      };
      expect(isSaveProficient(character, 'strength')).toBe(true);
      expect(isSaveProficient(character, 'dexterity')).toBe(false);
    });

    it('should return false if both options indicate non-proficient', () => {
      const character: any = {
        abilityScores: {
          strength: { score: 10 },
        },
      };
      expect(isSaveProficient(character, 'strength')).toBe(false);
      expect(isSaveProficient(character, 'wisdom')).toBe(false);
    });
  });
});
