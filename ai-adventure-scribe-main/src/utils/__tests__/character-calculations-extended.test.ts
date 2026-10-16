/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';

import {
  calculateProficiencyBonus,
  getSpellcastingAbility
} from '../character-calculations';

describe('character-calculations extended', () => {
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
