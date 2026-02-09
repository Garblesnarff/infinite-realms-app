/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';

import {
  calculateRacialBonuses,
  getTotalRacialBonus,
  applyRacialBonuses,
  formatRacialBonus,
} from '../racialAbilityBonuses';

describe('racialAbilityBonuses', () => {
  describe('calculateRacialBonuses', () => {
    it('should return empty array when race is null', () => {
      expect(calculateRacialBonuses(null, null)).toEqual([]);
    });

    it('should return bonuses for a base race (e.g. Human)', () => {
      const race = {
        id: 'human',
        abilityScoreIncrease: {
          strength: 1,
          dexterity: 1,
          constitution: 1,
          intelligence: 1,
          wisdom: 1,
          charisma: 1,
        },
      } as any;
      const bonuses = calculateRacialBonuses(race, null);
      expect(bonuses).toHaveLength(6);
      expect(bonuses).toContainEqual({ ability: 'strength', bonus: 1 });
    });

    it('should stack race and subrace bonuses', () => {
      const race = {
        id: 'dwarf',
        abilityScoreIncrease: { constitution: 2 },
      } as any;
      const subrace = {
        id: 'hill-dwarf',
        abilityScoreIncrease: { wisdom: 1 },
      } as any;
      const bonuses = calculateRacialBonuses(race, subrace);
      expect(bonuses).toHaveLength(2);
      expect(bonuses).toContainEqual({ ability: 'constitution', bonus: 2 });
      expect(bonuses).toContainEqual({ ability: 'wisdom', bonus: 1 });
    });

    it('should handle Half-Elf choices', () => {
      const race = {
        id: 'half-elf',
        abilityScoreIncrease: { charisma: 2 },
      } as any;
      const choices = {
        halfElf: ['strength', 'dexterity'] as [string, string],
      };
      const bonuses = calculateRacialBonuses(race, null, choices);
      expect(bonuses).toContainEqual({ ability: 'charisma', bonus: 2 });
      expect(bonuses).toContainEqual({ ability: 'strength', bonus: 1 });
      expect(bonuses).toContainEqual({ ability: 'dexterity', bonus: 1 });
    });

    it('should handle Variant Human choices', () => {
      const race = { id: 'human' } as any;
      const subrace = {
        id: 'variant-human',
        abilityScoreIncrease: {},
      } as any;
      const choices = {
        variantHuman: ['intelligence', 'wisdom'] as [string, string],
      };
      const bonuses = calculateRacialBonuses(race, subrace, choices);
      expect(bonuses).toContainEqual({ ability: 'intelligence', bonus: 1 });
      expect(bonuses).toContainEqual({ ability: 'wisdom', bonus: 1 });
    });
  });

  describe('getTotalRacialBonus', () => {
    it('should sum multiple bonuses for the same ability', () => {
      const bonuses = [
        { ability: 'strength' as any, bonus: 1 },
        { ability: 'strength' as any, bonus: 1 },
        { ability: 'dexterity' as any, bonus: 1 },
      ];
      expect(getTotalRacialBonus('strength', bonuses)).toBe(2);
      expect(getTotalRacialBonus('dexterity', bonuses)).toBe(1);
      expect(getTotalRacialBonus('wisdom', bonuses)).toBe(0);
    });
  });

  describe('applyRacialBonuses', () => {
    const baseScores = {
      strength: 10,
      dexterity: 10,
      constitution: 10,
      intelligence: 10,
      wisdom: 10,
      charisma: 10,
    };

    it('should apply bonuses correctly', () => {
      const bonuses = [
        { ability: 'strength' as any, bonus: 2 },
        { ability: 'constitution' as any, bonus: 1 },
      ];
      const final = applyRacialBonuses(baseScores, bonuses);
      expect(final.strength).toBe(12);
      expect(final.constitution).toBe(11);
      expect(final.dexterity).toBe(10);
    });

    it('should cap final scores at 20', () => {
      const highScores = { ...baseScores, strength: 19 };
      const bonuses = [{ ability: 'strength' as any, bonus: 2 }];
      const final = applyRacialBonuses(highScores, bonuses);
      expect(final.strength).toBe(20);
    });

    it('should handle missing ability in baseScores', () => {
      const incompleteScores = {} as any;
      const bonuses = [{ ability: 'strength' as any, bonus: 2 }];
      const final = applyRacialBonuses(incompleteScores, bonuses);
      expect(final.strength).toBe(2);
    });
  });

  describe('formatRacialBonus', () => {
    it('should format positive bonuses with a plus sign', () => {
      expect(formatRacialBonus(2)).toBe('+2');
      expect(formatRacialBonus(1)).toBe('+1');
    });

    it('should format zero or negative bonuses without a plus sign', () => {
      expect(formatRacialBonus(0)).toBe('0');
      expect(formatRacialBonus(-1)).toBe('-1');
    });
  });
});
