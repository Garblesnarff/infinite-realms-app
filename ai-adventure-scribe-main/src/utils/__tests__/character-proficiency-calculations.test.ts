/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest';
import {
  calculateSkillModifiers,
  getClassSkillProficiencies,
  getRaceSkillProficiencies,
  calculateSavingThrowModifiers,
  getClassSavingThrowProficiencies,
} from '../character-proficiency-calculations';
import type { Character } from '@/types/character';

describe('character-proficiency-calculations', () => {
  const mockAbilityScores: any = {
    strength: { modifier: 3 },
    dexterity: { modifier: 2 },
    constitution: { modifier: 1 },
    intelligence: { modifier: 0 },
    wisdom: { modifier: -1 },
    charisma: { modifier: 2 },
  };

  describe('calculateSkillModifiers', () => {
    it('uses the proficiencies actually chosen during character creation', () => {
      const character = {
        level: 1,
        class: { name: 'Fighter' },
        abilityScores: mockAbilityScores,
        skillProficiencies: ['Stealth', 'Persuasion'],
      } as Character;

      const skillMods = calculateSkillModifiers(character);

      expect(skillMods.Stealth).toMatchObject({ modifier: 4, proficient: true });
      expect(skillMods.Persuasion).toMatchObject({ modifier: 4, proficient: true });
      expect(skillMods.Athletics).toMatchObject({ modifier: 3, proficient: false });
    });

    it('should calculate skill modifiers with proficiency bonus', () => {
      const character: Partial<Character> = {
        level: 1, // Proficiency bonus = 2
        class: { name: 'Fighter' } as any, // Athletics
        race: { name: 'Human' } as any,
        abilityScores: mockAbilityScores,
      };

      const skillMods = calculateSkillModifiers(character as Character);

      // Athletics (Str): 3 (mod) + 2 (pb) = 5
      expect(skillMods['Athletics']).toEqual({
        modifier: 5,
        proficient: true,
        expertise: false,
      });

      // Stealth (Dex): 2 (mod) + 0 (not proficient) = 2
      expect(skillMods['Stealth']).toEqual({
        modifier: 2,
        proficient: false,
        expertise: false,
      });
    });

    it('should use provided proficiency bonus', () => {
      const character: Partial<Character> = {
        level: 1,
        class: { name: 'Wizard' } as any, // Arcana, History, Insight, Investigation, Medicine, Religion
        abilityScores: mockAbilityScores,
      };

      const skillMods = calculateSkillModifiers(character as Character, 5);

      // Arcana (Int): 0 (mod) + 5 (pb) = 5
      expect(skillMods['Arcana'].modifier).toBe(5);
    });

    it('should combine class and race proficiencies', () => {
      const character: Partial<Character> = {
        level: 1, // pb = 2
        class: { name: 'Cleric' } as any, // History, Insight, Medicine, Persuasion, Religion
        race: { name: 'Half-Elf' } as any, // Deception, Persuasion
        abilityScores: mockAbilityScores,
      };

      const skillMods = calculateSkillModifiers(character as Character);

      // Persuasion (Cha) is in both: 2 (mod) + 2 (pb) = 4
      expect(skillMods['Persuasion'].proficient).toBe(true);
      expect(skillMods['Persuasion'].modifier).toBe(4);

      // Deception (Cha) from race: 2 (mod) + 2 (pb) = 4
      expect(skillMods['Deception'].proficient).toBe(true);

      // Medicine (Wis) from class: -1 (mod) + 2 (pb) = 1
      expect(skillMods['Medicine'].proficient).toBe(true);
      expect(skillMods['Medicine'].modifier).toBe(1);
    });

    it('should handle character with no class or race', () => {
      const character: Partial<Character> = {
        level: 1,
        abilityScores: mockAbilityScores,
      };

      const skillMods = calculateSkillModifiers(character as Character);

      Object.values(skillMods).forEach(mod => {
        expect(mod.proficient).toBe(false);
      });
    });

    it('should handle missing ability scores gracefully', () => {
      const character: Partial<Character> = {
        level: 1,
      };
      // Should not throw and use default 0 modifier
      const skillMods = calculateSkillModifiers(character as Character);
      expect(skillMods['Athletics'].modifier).toBe(0);
    });

    it('should handle partially missing ability scores', () => {
      const character: Partial<Character> = {
        level: 1,
        class: { name: 'Fighter' } as any,
        abilityScores: {
          strength: { modifier: 3 }
        } as any
      };
      const skillMods = calculateSkillModifiers(character as Character);
      expect(skillMods['Athletics'].modifier).toBe(5); // 3 + 2
      expect(skillMods['Stealth'].modifier).toBe(0); // fallback to 0
    });

    it('should handle missing character level', () => {
      const character: Partial<Character> = {
        abilityScores: mockAbilityScores,
      };
      // Default level 1 -> pb 2
      const skillMods = calculateSkillModifiers(character as Character);
      expect(skillMods['Athletics'].modifier).toBe(3); // no prof, so just mod
    });
  });

  describe('getClassSkillProficiencies', () => {
    it('should return proficiencies for valid class', () => {
      const profs = getClassSkillProficiencies({ name: 'Rogue' } as any);
      expect(profs).toContain('Stealth');
      expect(profs).toContain('Acrobatics');
      expect(profs.length).toBeGreaterThan(0);
    });

    it('should return empty array for invalid or null class', () => {
      expect(getClassSkillProficiencies(null)).toEqual([]);
      expect(getClassSkillProficiencies({ name: 'Unknown' } as any)).toEqual([]);
    });

    it('should handle falsy profs from map', () => {
      // Testing the ternary branch where profs is undefined
      expect(getClassSkillProficiencies({ name: 'UnknownClass' } as any)).toEqual([]);
    });
  });

  describe('getRaceSkillProficiencies', () => {
    it('should combine race and subrace proficiencies', () => {
      const profs = getRaceSkillProficiencies(
        { name: 'Half-Elf' } as any,
        { name: 'Wood Elf' } as any
      );
      // Half-Elf: Deception, Persuasion
      // Wood Elf subrace: Stealth
      expect(profs).toContain('Deception');
      expect(profs).toContain('Persuasion');
      expect(profs).toContain('Stealth');
    });

    it('should handle null subrace', () => {
      const profs = getRaceSkillProficiencies({ name: 'Half-Elf' } as any, null);
      expect(profs).toEqual(['Deception', 'Persuasion']);
    });

    it('should handle null race', () => {
      expect(getRaceSkillProficiencies(null, { name: 'Wood Elf' } as any)).toEqual([]);
    });

    it('should handle subrace with no traits', () => {
      // Testing the case where characterSubrace exists but has no profs in map
      const profs = getRaceSkillProficiencies(
        { name: 'Half-Elf' } as any,
        { name: 'GenericSubrace' } as any
      );
      expect(profs).toEqual(['Deception', 'Persuasion']);
    });
  });

  describe('calculateSavingThrowModifiers', () => {
    it('should calculate saving throw modifiers correctly', () => {
      const character: Partial<Character> = {
        level: 1, // pb = 2
        class: { name: 'Fighter' } as any, // strength, constitution
        abilityScores: mockAbilityScores,
      };

      const saveMods = calculateSavingThrowModifiers(character as Character);

      // Strength: 3 (mod) + 2 (pb) = 5
      expect(saveMods['strength']).toEqual({
        modifier: 5,
        proficient: true,
      });

      // Dexterity: 2 (mod) + 0 (not proficient) = 2
      expect(saveMods['dexterity']).toEqual({
        modifier: 2,
        proficient: false,
      });

      // Constitution: 1 (mod) + 2 (pb) = 3
      expect(saveMods['constitution']).toEqual({
        modifier: 3,
        proficient: true,
      });
    });

    it('should handle provided proficiency bonus', () => {
      const character: Partial<Character> = {
        class: { name: 'Wizard' } as any, // intelligence, wisdom
        abilityScores: mockAbilityScores,
      };

      const saveMods = calculateSavingThrowModifiers(character as Character, 4);

      // Intelligence: 0 (mod) + 4 (pb) = 4
      expect(saveMods['intelligence'].modifier).toBe(4);
    });

    it('should handle missing character level for saves', () => {
      const character: Partial<Character> = {
        class: { name: 'Wizard' } as any,
        abilityScores: mockAbilityScores,
      };
      // Default level 1 -> pb 2
      const saveMods = calculateSavingThrowModifiers(character as Character);
      expect(saveMods['intelligence'].modifier).toBe(2); // 0 mod + 2 pb
    });

    it('should handle missing ability scores gracefully', () => {
      const character: Partial<Character> = {
        class: { name: 'Fighter' } as any,
      };
      expect(calculateSavingThrowModifiers(character as Character)).toEqual({});
    });
  });

  describe('getClassSavingThrowProficiencies', () => {
    it('should return saving throws for valid class', () => {
      const profs = getClassSavingThrowProficiencies({ name: 'Cleric' } as any);
      expect(profs).toContain('wisdom');
      expect(profs).toContain('charisma');
    });

    it('should return empty array for null class', () => {
      expect(getClassSavingThrowProficiencies(null)).toEqual([]);
    });

    it('should return empty array for unknown class', () => {
      expect(getClassSavingThrowProficiencies({ name: 'UnknownClass' } as any)).toEqual([]);
    });
  });
});
