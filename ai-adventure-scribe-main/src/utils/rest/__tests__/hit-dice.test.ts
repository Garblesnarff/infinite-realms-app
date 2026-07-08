/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { calculateMaxHitDice, rollHitDice, recoverHitDice } from '../hit-dice';

import { rollDie } from '@/utils/diceRolls';

vi.mock('@/utils/diceRolls', () => ({
  rollDie: vi.fn(),
}));

describe('hit-dice utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('calculateMaxHitDice', () => {
    it('should return half level rounded up for single class', () => {
      const character: any = {
        classLevels: [{ level: 5 }]
      };
      expect(calculateMaxHitDice(character)).toBe(3);
    });

    it('should return minimum 1 for level 1 character', () => {
      const character: any = {
        classLevels: [{ level: 1 }]
      };
      expect(calculateMaxHitDice(character)).toBe(1);
    });

    it('should handle multiclass characters', () => {
      const character: any = {
        classLevels: [{ level: 5 }, { level: 3 }]
      };
      expect(calculateMaxHitDice(character)).toBe(4);
    });

    it('should handle characters with no classLevels using total level', () => {
       const character: any = {
         level: 5,
         classLevels: []
       };
       expect(calculateMaxHitDice(character)).toBe(3);
    });

    it('should return minimum 1 for level 1 character with no classLevels', () => {
       const character: any = {
         level: 1,
         classLevels: []
       };
       // Current implementation: Math.floor(1/2) = 0.
       // This test will fail until the bug is fixed.
       expect(calculateMaxHitDice(character)).toBe(1);
    });
  });

  describe('rollHitDice', () => {
    it('should return 0 if no hitDice or numDice <= 0', () => {
      const character: any = {};
      expect(rollHitDice(character, 0).hitPointsRecovered).toBe(0);

      const charWithDice: any = { hitDice: { remaining: 1, type: 'd8' } };
      expect(rollHitDice(charWithDice, 0).hitPointsRecovered).toBe(0);
    });

    it('should recover HP and decrement remaining dice', () => {
      const character: any = {
        hitDice: { type: 'd8', remaining: 2, total: 2 },
        abilityScores: { constitution: { modifier: 2 } },
        hitPoints: { current: 10, maximum: 30 }
      };
      vi.mocked(rollDie).mockReturnValue(5);

      const result = rollHitDice(character, 1);

      expect(result.hitPointsRecovered).toBe(7); // 5 + 2
      expect(result.updatedCharacter.hitDice.remaining).toBe(1);
      expect(result.updatedCharacter.hitPoints.current).toBe(17);
    });

    it('should respect minimum 1 HP recovered', () => {
      const character: any = {
        hitDice: { type: 'd8', remaining: 1, total: 1 },
        abilityScores: { constitution: { modifier: -5 } },
        hitPoints: { current: 10, maximum: 30 }
      };
      vi.mocked(rollDie).mockReturnValue(2);

      const result = rollHitDice(character, 1);

      expect(result.hitPointsRecovered).toBe(1); // 2 - 5 = -3, min 1
      expect(result.updatedCharacter.hitPoints.current).toBe(11);
    });

    it('should not exceed maximum HP', () => {
       const character: any = {
        hitDice: { type: 'd8', remaining: 1, total: 1 },
        abilityScores: { constitution: { modifier: 2 } },
        hitPoints: { current: 28, maximum: 30 }
      };
      vi.mocked(rollDie).mockReturnValue(8);

      const result = rollHitDice(character, 1);

      expect(result.hitPointsRecovered).toBe(10);
      expect(result.updatedCharacter.hitPoints.current).toBe(30);
    });

    it('should default to d8 if type is invalid', () => {
       const character: any = {
        hitDice: { type: 'invalid', remaining: 1, total: 1 },
        abilityScores: { constitution: { modifier: 0 } },
        hitPoints: { current: 10, maximum: 30 }
      };
      vi.mocked(rollDie).mockReturnValue(5);

      const result = rollHitDice(character, 1);
      expect(rollDie).toHaveBeenCalledWith(8);
      expect(result.hitPointsRecovered).toBe(5);
    });
  });

  describe('recoverHitDice', () => {
    it('should return character as is if no hitDice', () => {
      const character: any = { name: 'Bob' };
      expect(recoverHitDice(character)).toEqual(character);
    });

    it('should recover half of max hit dice', () => {
      const character: any = {
        classLevels: [{ level: 10 }],
        hitDice: { total: 10, remaining: 2 }
      };
      // max hit dice = 5
      const updated = recoverHitDice(character);
      expect(updated.hitDice.remaining).toBe(7);
    });

    it('should not exceed total hit dice', () => {
      const character: any = {
        classLevels: [{ level: 10 }],
        hitDice: { total: 10, remaining: 8 }
      };
      const updated = recoverHitDice(character);
      expect(updated.hitDice.remaining).toBe(10);
    });

    it('rounds half the character level up on odd levels', () => {
      const character: any = {
        level: 5,
        hitDice: { total: 5, remaining: 0 },
      };

      expect(recoverHitDice(character).hitDice.remaining).toBe(3);
    });
  });
});
