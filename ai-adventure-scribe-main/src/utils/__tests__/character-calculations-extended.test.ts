/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';

import {
  calculateArmorClass,
  calculateProficiencyBonus,
  getSpellcastingAbility
} from '../character-calculations';

import type { Character } from '@/types/character';

describe('character-calculations extended', () => {
  const baseCharacter: Partial<Character> = {
    level: 1,
    abilityScores: {
      strength: { score: 10, modifier: 0, savingThrow: false },
      dexterity: { score: 10, modifier: 0, savingThrow: false },
      constitution: { score: 10, modifier: 0, savingThrow: false },
      intelligence: { score: 10, modifier: 0, savingThrow: false },
      wisdom: { score: 10, modifier: 0, savingThrow: false },
      charisma: { score: 10, modifier: 0, savingThrow: false },
    } as any,
  };

  describe('calculateArmorClass - Unarmored Defense', () => {
    it('should calculate Barbarian Unarmored Defense correctly (10 + Dex + Con)', () => {
      const barbarian: Partial<Character> = {
        ...baseCharacter,
        class: { name: 'Barbarian' } as any,
        abilityScores: {
          ...baseCharacter.abilityScores,
          dexterity: { modifier: 2 },
          constitution: { modifier: 3 },
        } as any,
      };
      // 10 + 2 (Dex) + 3 (Con) = 15
      expect(calculateArmorClass(barbarian as Character)).toBe(15);
    });

    it('should allow shields with Barbarian Unarmored Defense', () => {
      const barbarian: Partial<Character> = {
        ...baseCharacter,
        class: { name: 'Barbarian' } as any,
        equippedShield: 'shield',
        abilityScores: {
          ...baseCharacter.abilityScores,
          dexterity: { modifier: 2 },
          constitution: { modifier: 3 },
        } as any,
      };
      // 10 + 2 (Dex) + 3 (Con) + 2 (Shield) = 17
      expect(calculateArmorClass(barbarian as Character)).toBe(17);
    });

    it('should calculate Monk Unarmored Defense correctly (10 + Dex + Wis)', () => {
      const monk: Partial<Character> = {
        ...baseCharacter,
        class: { name: 'Monk' } as any,
        abilityScores: {
          ...baseCharacter.abilityScores,
          dexterity: { modifier: 3 },
          wisdom: { modifier: 2 },
        } as any,
      };
      // 10 + 3 (Dex) + 2 (Wis) = 15
      expect(calculateArmorClass(monk as Character)).toBe(15);
    });

    it('should NOT allow shields with Monk Unarmored Defense (falls back to 10 + Dex + Shield)', () => {
      const monk: Partial<Character> = {
        ...baseCharacter,
        class: { name: 'Monk' } as any,
        equippedShield: 'shield',
        abilityScores: {
          ...baseCharacter.abilityScores,
          dexterity: { modifier: 3 },
          wisdom: { modifier: 2 },
        } as any,
      };
      // Monk Unarmored Defense disabled by shield.
      // Base AC 10 + 3 (Dex) + 2 (Shield) = 15.
      // Wait, let's check code logic.
      // If monk has shield, hasUnarmoredDefense is true, but the monk switch case checks !equippedShield.
      // If it has shield, it breaks and falls through to armor calculation.
      // armor calculation: baseAC (10) + dexMod (3) + shieldBonus (2) = 15.
      expect(calculateArmorClass(monk as Character)).toBe(15);
    });
  });

  describe('calculateProficiencyBonus', () => {
    it('should return 2 at levels 1-4', () => {
      expect(calculateProficiencyBonus(1)).toBe(2);
      expect(calculateProficiencyBonus(4)).toBe(2);
    });

    it('should return 3 at levels 5-8', () => {
      expect(calculateProficiencyBonus(5)).toBe(3);
      expect(calculateProficiencyBonus(8)).toBe(3);
    });

    it('should return 4 at levels 9-12', () => {
      expect(calculateProficiencyBonus(9)).toBe(4);
      expect(calculateProficiencyBonus(12)).toBe(4);
    });

    it('should return 5 at levels 13-16', () => {
      expect(calculateProficiencyBonus(13)).toBe(5);
      expect(calculateProficiencyBonus(16)).toBe(5);
    });

    it('should return 6 at levels 17-20', () => {
      expect(calculateProficiencyBonus(17)).toBe(6);
      expect(calculateProficiencyBonus(20)).toBe(6);
    });
  });

  describe('getSpellcastingAbility mapping', () => {
    const classes = [
      { name: 'Wizard', expected: 'intelligence' },
      { name: 'Sorcerer', expected: 'charisma' },
      { name: 'Warlock', expected: 'charisma' },
      { name: 'Bard', expected: 'charisma' },
      { name: 'Cleric', expected: 'wisdom' },
      { name: 'Druid', expected: 'wisdom' },
      { name: 'Paladin', expected: 'charisma' },
      { name: 'Ranger', expected: 'wisdom' },
      { name: 'Eldritch Knight', expected: 'intelligence' },
      { name: 'Arcane Trickster', expected: 'intelligence' },
    ];

    classes.forEach(({ name, expected }) => {
      it(`should return ${expected} for ${name}`, () => {
        expect(getSpellcastingAbility({ name } as any)).toBe(expected);
      });
    });

    it('should return null for non-spellcasting classes', () => {
      expect(getSpellcastingAbility({ name: 'Fighter' } as any)).toBe(null);
      expect(getSpellcastingAbility({ name: 'Barbarian' } as any)).toBe(null);
      expect(getSpellcastingAbility(null)).toBe(null);
    });
  });
});
