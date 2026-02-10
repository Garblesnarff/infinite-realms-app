/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';

import { calculateStealthBonus } from '../stealthUtils';

describe('stealthUtils', () => {
  describe('calculateStealthBonus', () => {
    it('should calculate correct bonus for level 1 (prof 2 + dex 2)', () => {
      const participant: any = { level: 1, conditions: [] };
      expect(calculateStealthBonus(participant)).toBe(4);
    });

    it('should calculate correct bonus for level 4 (prof 2 + dex 2)', () => {
      const participant: any = { level: 4, conditions: [] };
      // Before fix it would be 3 + 2 = 5
      expect(calculateStealthBonus(participant)).toBe(4);
    });

    it('should calculate correct bonus for level 5 (prof 3 + dex 2)', () => {
      const participant: any = { level: 5, conditions: [] };
      expect(calculateStealthBonus(participant)).toBe(5);
    });
  });
});
