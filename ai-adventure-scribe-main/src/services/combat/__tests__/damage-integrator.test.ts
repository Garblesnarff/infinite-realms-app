import { describe, it, expect } from 'vitest';

import { calculateDamage as calculateModifiedDamage } from '@/utils/diceUtils';

describe('DamageIntegrator', () => {
  describe('calculateModifiedDamage', () => {
    it('should return base damage when no modifiers apply', () => {
      const result = calculateModifiedDamage(10, 'slashing', [], [], []);
      expect(result).toBe(10);
    });

    it('should return 0 when immune', () => {
      const result = calculateModifiedDamage(10, 'fire', [], ['fire'], []);
      expect(result).toBe(0);
    });

    it('should return half damage (floored) when resistant', () => {
      const result1 = calculateModifiedDamage(10, 'cold', ['cold'], [], []);
      expect(result1).toBe(5);

      const result2 = calculateModifiedDamage(11, 'cold', ['cold'], [], []);
      expect(result2).toBe(5); // floor(11/2) = 5
    });

    it('should return double damage when vulnerable', () => {
      const result = calculateModifiedDamage(10, 'radiant', [], [], ['radiant']);
      expect(result).toBe(20);
    });

    it('should apply BOTH resistance and vulnerability', () => {
      // D&D 5e: 11 damage -> Resistance (5) -> Vulnerability (10)
      // This is expected to fail with the current implementation which returns 5
      const result = calculateModifiedDamage(11, 'necrotic', ['necrotic'], [], ['necrotic']);
      expect(result).toBe(10);
    });
  });
});
