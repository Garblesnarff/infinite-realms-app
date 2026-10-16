/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  calculateProficiencyBonus,
  calculateHitPoints,
  calculateCarryingCapacity,
  SKILLS_MAP,
} from '../basic-math';

describe('basic-math', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('calculateProficiencyBonus', () => {
    it('should calculate correct bonus for various levels', () => {
      expect(calculateProficiencyBonus(1)).toBe(2);
      expect(calculateProficiencyBonus(4)).toBe(2);
      expect(calculateProficiencyBonus(5)).toBe(3);
      expect(calculateProficiencyBonus(8)).toBe(3);
      expect(calculateProficiencyBonus(9)).toBe(4);
      expect(calculateProficiencyBonus(12)).toBe(4);
      expect(calculateProficiencyBonus(13)).toBe(5);
      expect(calculateProficiencyBonus(16)).toBe(5);
      expect(calculateProficiencyBonus(17)).toBe(6);
      expect(calculateProficiencyBonus(20)).toBe(6);
    });
  });

  describe('calculateHitPoints', () => {
    it('should calculate hit points correctly for level 1', () => {
      const character: any = {
        level: 1,
        abilityScores: { constitution: { modifier: 2 } },
        class: { hitDie: 10 },
      };
      // 10 + 2 = 12
      expect(calculateHitPoints(character)).toBe(12);
    });

    it('should calculate hit points correctly for higher levels', () => {
      const character: any = {
        level: 3,
        abilityScores: { constitution: { modifier: 2 } },
        class: { hitDie: 10 },
      };
      // Level 1: 10 + 2 = 12
      // Level 2: (10/2 + 1) + 2 = 6 + 2 = 8
      // Level 3: 8
      // Total: 12 + 8 + 8 = 28
      expect(calculateHitPoints(character)).toBe(28);
    });

    it('should enforce minimum 1 HP per level contribution', () => {
      const character: any = {
        level: 2,
        abilityScores: { constitution: { modifier: -5 } },
        class: { hitDie: 6 },
      };
      // Level 1: max(1, 6 - 5) = 1
      // Level 2: max(1, floor(6/2) + 1 - 5) = max(1, 3 + 1 - 5) = 1
      // Total: 2
      expect(calculateHitPoints(character)).toBe(2);
    });

    it('should resolve the hit die from a class name when the class record is partial', () => {
      const character: any = {
        level: 1,
        abilityScores: { constitution: { modifier: 0 } },
        class: { name: 'Wizard' },
      };

      expect(calculateHitPoints(character)).toBe(6);
    });

    it('should reject missing class data instead of assuming a d8', () => {
      expect(() => calculateHitPoints({} as any)).toThrow(
        'Cannot calculate hit points without a resolved character class',
      );
    });

    it('should handle partial character data with null abilityScores', () => {
      const character: any = {
        level: 1,
        abilityScores: null,
        class: { hitDie: 10 },
      };
      // 10 + 0 = 10
      expect(calculateHitPoints(character)).toBe(10);
    });
  });

  describe('SKILLS_MAP', () => {
    it('should map skills to correct ability scores', () => {
      expect(SKILLS_MAP.Acrobatics).toBe('dexterity');
      expect(SKILLS_MAP.Athletics).toBe('strength');
      expect(SKILLS_MAP.Perception).toBe('wisdom');
      expect(SKILLS_MAP.Arcana).toBe('intelligence');
      expect(SKILLS_MAP.Persuasion).toBe('charisma');
      expect(Object.keys(SKILLS_MAP).length).toBe(18);
    });
  });

  describe('calculateCarryingCapacity', () => {
    it('should calculate correctly based on strength score', () => {
      const character: any = {
        abilityScores: { strength: { score: 12 } },
      };
      expect(calculateCarryingCapacity(character)).toBe(180);
    });

    it('should fallback to 10 strength if score is missing', () => {
      const character: any = {};
      expect(calculateCarryingCapacity(character)).toBe(150);
    });
  });
});
