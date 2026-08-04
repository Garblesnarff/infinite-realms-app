/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { describe, it, expect, beforeEach } from 'vitest';

import {
  calculateSkillModifiers,
  getClassSkillProficiencies,
  getRaceSkillProficiencies,
  calculateSavingThrowModifiers,
  getClassSavingThrowProficiencies,
} from '../character-proficiency-calculations';

import type { Character } from '@/types/character';

describe('character-proficiency-calculations', () => {
  beforeEach(() => {
    // There are module-level caches in the module. Since we can't easily clear private variables,
    // we'll verify behavior across calls and check that different key parameters bust the cache.
  });

  describe('getClassSkillProficiencies', () => {
    it('should return correct proficiencies for Fighter', () => {
      const fighterClass = { name: 'Fighter' } as any;
      const profs = getClassSkillProficiencies(fighterClass);
      expect(profs).toContain('Athletics');
      expect(profs).toContain('Acrobatics');
      expect(profs).not.toContain('Arcana');
    });

    it('should return correct proficiencies for Wizard', () => {
      const wizardClass = { name: 'Wizard' } as any;
      const profs = getClassSkillProficiencies(wizardClass);
      expect(profs).toContain('Arcana');
      expect(profs).toContain('History');
      expect(profs).not.toContain('Athletics');
    });

    it('should return empty array for unknown class name', () => {
      const unknownClass = { name: 'Sorcerer' } as any;
      const profs = getClassSkillProficiencies(unknownClass);
      expect(profs).toEqual([]);
    });

    it('should return empty array for null or undefined class', () => {
      expect(getClassSkillProficiencies(null)).toEqual([]);
      expect(getClassSkillProficiencies(undefined)).toEqual([]);
    });

    it('should protect the cache from mutation', () => {
      const fighterClass = { name: 'Fighter' } as any;
      const profs1 = getClassSkillProficiencies(fighterClass);
      profs1.push('MutatedSkill');

      const profs2 = getClassSkillProficiencies(fighterClass);
      expect(profs2).not.toContain('MutatedSkill');
    });
  });

  describe('getRaceSkillProficiencies', () => {
    it('should return empty array for null/undefined race', () => {
      expect(getRaceSkillProficiencies(null, null)).toEqual([]);
      expect(getRaceSkillProficiencies(undefined, undefined)).toEqual([]);
    });

    it('should return correct proficiencies for Half-Elf with no subrace', () => {
      const race = { name: 'Half-Elf' } as any;
      const profs = getRaceSkillProficiencies(race, null);
      expect(profs).toContain('Deception');
      expect(profs).toContain('Persuasion');
    });

    it('should combine race and subrace proficiencies and remove duplicates', () => {
      const race = { name: 'Half-Elf' } as any;
      const subrace = { name: 'Wood Elf' } as any; // Wood Elf gives Stealth, Lightfoot Halfling gives Stealth too
      const profs = getRaceSkillProficiencies(race, subrace);
      expect(profs).toContain('Deception');
      expect(profs).toContain('Persuasion');
      expect(profs).toContain('Stealth');
    });

    it('should return cached result on successive calls', () => {
      const race = { name: 'Human (Variant)' } as any;
      const profs1 = getRaceSkillProficiencies(race, null);
      const profs2 = getRaceSkillProficiencies(race, null);
      expect(profs1).toEqual(profs2);
    });

    it('should handle unknown race name and unknown subrace name gracefully', () => {
      const race = { name: 'Dragonborn' } as any;
      const subrace = { name: 'Gold' } as any;
      const profs = getRaceSkillProficiencies(race, subrace);
      expect(profs).toEqual([]);
    });
  });

  describe('getClassSavingThrowProficiencies', () => {
    it('should return correct saving throws for Fighter', () => {
      const fighterClass = { name: 'Fighter' } as any;
      const profs = getClassSavingThrowProficiencies(fighterClass);
      expect(profs).toEqual(['strength', 'constitution']);
    });

    it('should return empty array for null/undefined class', () => {
      expect(getClassSavingThrowProficiencies(null)).toEqual([]);
      expect(getClassSavingThrowProficiencies(undefined)).toEqual([]);
    });

    it('should protect saving throw cache from mutation', () => {
      const fighterClass = { name: 'Fighter' } as any;
      const profs1 = getClassSavingThrowProficiencies(fighterClass);
      profs1.push('dexterity');

      const profs2 = getClassSavingThrowProficiencies(fighterClass);
      expect(profs2).toEqual(['strength', 'constitution']);
    });
  });

  describe('calculateSavingThrowModifiers', () => {
    const mockCharacter: Character = {
      level: 1,
      class: { name: 'Fighter' } as any,
      abilityScores: {
        strength: { score: 16, modifier: 3, savingThrow: false },
        dexterity: { score: 10, modifier: 0, savingThrow: false },
        constitution: { score: 14, modifier: 2, savingThrow: false },
        intelligence: { score: 8, modifier: -1, savingThrow: false },
        wisdom: { score: 12, modifier: 1, savingThrow: false },
        charisma: { score: 13, modifier: 1, savingThrow: false },
      },
    };

    it('should calculate saving throw modifiers including proficiency bonus', () => {
      // Fighter has strength and constitution saving throw proficiencies.
      // At level 1, proficiency bonus is +2.
      const result = calculateSavingThrowModifiers(mockCharacter);

      // Strength: modifier 3 + proficiency 2 = 5
      expect(result.strength).toEqual({ modifier: 5, proficient: true });
      // Constitution: modifier 2 + proficiency 2 = 4
      expect(result.constitution).toEqual({ modifier: 4, proficient: true });
      // Dexterity: modifier 0 + proficiency 0 = 0
      expect(result.dexterity).toEqual({ modifier: 0, proficient: false });
      // Intelligence: modifier -1 + proficiency 0 = -1
      expect(result.intelligence).toEqual({ modifier: -1, proficient: false });
    });

    it('should accept an explicit custom proficiency bonus', () => {
      const result = calculateSavingThrowModifiers(mockCharacter, 4);

      // Strength: modifier 3 + proficiency 4 = 7
      expect(result.strength).toEqual({ modifier: 7, proficient: true });
    });

    it('should handle missing ability scores gracefully', () => {
      const incompleteCharacter: Character = {
        level: 5,
        class: { name: 'Fighter' } as any,
      };

      const result = calculateSavingThrowModifiers(incompleteCharacter);
      expect(result).toEqual({});
    });
  });

  describe('calculateSkillModifiers', () => {
    const mockCharacter: Character = {
      level: 1, // PB = 2
      class: { name: 'Fighter' } as any,
      race: { name: 'Human' } as any,
      abilityScores: {
        strength: { score: 16, modifier: 3, savingThrow: false },
        dexterity: { score: 14, modifier: 2, savingThrow: false },
        constitution: { score: 12, modifier: 1, savingThrow: false },
        intelligence: { score: 10, modifier: 0, savingThrow: false },
        wisdom: { score: 8, modifier: -1, savingThrow: false },
        charisma: { score: 12, modifier: 1, savingThrow: false },
      },
    };

    it('should calculate skill modifiers using default class/race skill proficiencies', () => {
      // Fighter gives Athletics, Acrobatics, etc. (we'll check a few)
      const result = calculateSkillModifiers(mockCharacter);

      // Athletics: STR (3) + proficient (2) = 5
      expect(result['Athletics']).toEqual({
        modifier: 5,
        proficient: true,
        expertise: false,
      });

      // Stealth: DEX (2) + not proficient (0) = 2
      expect(result['Stealth']).toEqual({
        modifier: 2,
        proficient: false,
        expertise: false,
      });

      // Survival: WIS (-1) + proficient (2) = 1
      expect(result['Survival']).toEqual({
        modifier: 1,
        proficient: true,
        expertise: false,
      });
    });

    it('should respect custom skillProficiencies if provided on character', () => {
      const customCharacter: Character = {
        ...mockCharacter,
        skillProficiencies: ['Stealth', 'Arcana'],
      };

      const result = calculateSkillModifiers(customCharacter);

      // Stealth is now proficient: DEX (2) + proficient (2) = 4
      expect(result['Stealth']).toEqual({
        modifier: 4,
        proficient: true,
        expertise: false,
      });

      // Athletics is no longer proficient: STR (3) + 0 = 3
      expect(result['Athletics']).toEqual({
        modifier: 3,
        proficient: false,
        expertise: false,
      });

      // Arcana is proficient: INT (0) + proficient (2) = 2
      expect(result['Arcana']).toEqual({
        modifier: 2,
        proficient: true,
        expertise: false,
      });
    });

    it('should respect custom expertiseProficiencies and apply double proficiency bonus', () => {
      const customCharacter: Character = {
        ...mockCharacter,
        skillProficiencies: ['Stealth'],
        expertiseProficiencies: ['Stealth'],
      };

      const result = calculateSkillModifiers(customCharacter);

      // Stealth is proficient and has expertise: DEX (2) + proficient (2) + expertise (2) = 6
      expect(result['Stealth']).toEqual({
        modifier: 6,
        proficient: true,
        expertise: true,
      });
    });

    it('should accept an explicit custom proficiency bonus', () => {
      const customCharacter: Character = {
        ...mockCharacter,
        skillProficiencies: ['Stealth'],
        expertiseProficiencies: ['Stealth'],
      };

      // Custom PB = 4
      const result = calculateSkillModifiers(customCharacter, 4);

      // Stealth is proficient and has expertise: DEX (2) + proficient (4) + expertise (4) = 10
      expect(result['Stealth']).toEqual({
        modifier: 10,
        proficient: true,
        expertise: true,
      });
    });

    it('should handle missing abilityScores modifier gracefully (default to 0)', () => {
      const incompleteCharacter: Character = {
        level: 1,
        skillProficiencies: ['Stealth'],
      };

      const result = calculateSkillModifiers(incompleteCharacter);

      // Stealth is proficient: default modifier (0) + proficient (2) = 2
      expect(result['Stealth']).toEqual({
        modifier: 2,
        proficient: true,
        expertise: false,
      });
    });

    it('should handle missing level (default to level 1 PB = 2)', () => {
      const characterNoLevel: Character = {
        skillProficiencies: ['Stealth'],
      };
      const result = calculateSkillModifiers(characterNoLevel);
      expect(result['Stealth'].modifier).toBe(2);
    });

    it('should hit the skill proficiencies set cache on successive calls with same character configuration', () => {
      const result1 = calculateSkillModifiers(mockCharacter);
      const result2 = calculateSkillModifiers(mockCharacter);
      expect(result1).toEqual(result2);
    });

    it('should hit the cache on successive calls with same chosen proficiencies', () => {
      const customCharacter: Character = {
        ...mockCharacter,
        skillProficiencies: ['Stealth'],
      };
      const result1 = calculateSkillModifiers(customCharacter);
      const result2 = calculateSkillModifiers(customCharacter);
      expect(result1).toEqual(result2);
    });
  });

  describe('calculateSavingThrowModifiers extra edge cases', () => {
    it('should handle missing level (default to level 1 PB = 2)', () => {
      const characterNoLevel: Character = {
        class: { name: 'Fighter' } as any,
        abilityScores: {
          strength: { score: 16, modifier: 3, savingThrow: false },
        } as any,
      };
      const result = calculateSavingThrowModifiers(characterNoLevel);
      expect(result.strength).toEqual({ modifier: 5, proficient: true });
    });

    it('should hit the saving throw set cache on successive calls', () => {
      const character: Character = {
        class: { name: 'Fighter' } as any,
        abilityScores: {
          strength: { score: 16, modifier: 3, savingThrow: false },
        } as any,
      };
      const result1 = calculateSavingThrowModifiers(character);
      const result2 = calculateSavingThrowModifiers(character);
      expect(result1).toEqual(result2);
    });
  });
});
