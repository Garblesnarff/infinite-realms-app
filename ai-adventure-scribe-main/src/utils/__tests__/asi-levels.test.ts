import { describe, it, expect } from 'vitest';

import { canChooseAbilityScoreImprovement } from '../asi-levels';

describe('canChooseAbilityScoreImprovement', () => {
  describe('Standard Class', () => {
    const standardClasses = ['wizard', 'cleric', 'barbarian', 'bard', 'druid', 'monk', 'paladin', 'ranger', 'sorcerer', 'warlock'];

    it('should return true for standard ASI levels', () => {
      const asiLevels = [4, 8, 12, 16, 19];
      for (const className of standardClasses) {
        for (const level of asiLevels) {
          expect(canChooseAbilityScoreImprovement(className, level)).toBe(true);
        }
      }
    });

    it('should return false for non-ASI levels', () => {
      const nonAsiLevels = [1, 2, 3, 5, 7, 9, 10, 11, 13, 14, 15, 17, 18, 20];
      for (const className of standardClasses) {
        for (const level of nonAsiLevels) {
          expect(canChooseAbilityScoreImprovement(className, level)).toBe(false);
        }
      }
    });
  });

  describe('Fighter Class', () => {
    it('should return true for fighter ASI levels (including level 6 and 14)', () => {
      const fighterAsiLevels = [4, 6, 8, 12, 14, 16, 19];
      const classNames = ['fighter', 'Fighter', 'FIGHTER'];

      for (const className of classNames) {
        for (const level of fighterAsiLevels) {
          expect(canChooseAbilityScoreImprovement(className, level)).toBe(true);
        }
      }
    });

    it('should return false for non-fighter ASI levels', () => {
      const nonFighterAsiLevels = [1, 2, 3, 5, 7, 9, 10, 11, 13, 15, 17, 18, 20];
      for (const level of nonFighterAsiLevels) {
        expect(canChooseAbilityScoreImprovement('Fighter', level)).toBe(false);
      }
    });
  });

  describe('Rogue Class', () => {
    it('should return true for rogue ASI levels (including level 10)', () => {
      const rogueAsiLevels = [4, 8, 10, 12, 16, 19];
      const classNames = ['rogue', 'Rogue', 'ROGUE'];

      for (const className of classNames) {
        for (const level of rogueAsiLevels) {
          expect(canChooseAbilityScoreImprovement(className, level)).toBe(true);
        }
      }
    });

    it('should return false for non-rogue ASI levels', () => {
      const nonRogueAsiLevels = [1, 2, 3, 5, 6, 7, 9, 11, 13, 14, 15, 17, 18, 20];
      for (const level of nonRogueAsiLevels) {
        expect(canChooseAbilityScoreImprovement('Rogue', level)).toBe(false);
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle undefined class name', () => {
      const asiLevels = [4, 8, 12, 16, 19];
      for (const level of asiLevels) {
        expect(canChooseAbilityScoreImprovement(undefined, level)).toBe(true);
      }

      const nonAsiLevels = [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15, 17, 18, 20];
      for (const level of nonAsiLevels) {
        expect(canChooseAbilityScoreImprovement(undefined, level)).toBe(false);
      }
    });

    it('should handle out of bounds or invalid levels', () => {
      expect(canChooseAbilityScoreImprovement('Fighter', 0)).toBe(false);
      expect(canChooseAbilityScoreImprovement('Fighter', -5)).toBe(false);
      expect(canChooseAbilityScoreImprovement('Rogue', 100)).toBe(false);
    });
  });
});
