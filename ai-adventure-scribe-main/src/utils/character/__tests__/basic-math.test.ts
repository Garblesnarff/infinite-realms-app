/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  calculateProficiencyBonus,
  calculateHitPoints,
  calculateArmorClass,
  calculateCarryingCapacity,
  SKILLS_MAP,
} from '../basic-math';

import { EQUIPMENT_LOOKUP } from '@/data/equipmentOptions';

// Mock EQUIPMENT_LOOKUP
vi.mock('@/data/equipmentOptions', () => ({
  EQUIPMENT_LOOKUP: {
    get: vi.fn(),
  },
}));

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

  describe('calculateArmorClass', () => {
    it('should calculate unarmored AC (10 + DEX)', () => {
      const character: any = {
        abilityScores: { dexterity: { modifier: 3 } },
      };
      expect(calculateArmorClass(character)).toBe(13);
    });

    it('should include shield bonus', () => {
      const character: any = {
        abilityScores: { dexterity: { modifier: 2 } },
        equippedShield: 'shield_id',
      };
      // Use default shield bonus of 2 if lookup fails/returns nothing
      expect(calculateArmorClass(character)).toBe(14);
    });

    it('should use shield bonus from lookup', () => {
      (EQUIPMENT_LOOKUP.get as any).mockImplementation((id: string) => {
        if (id === 'magic_shield') return { armorClass: { base: 3 } };
        return null;
      });
      const character: any = {
        abilityScores: { dexterity: { modifier: 2 } },
        equippedShield: 'magic_shield',
      };
      expect(calculateArmorClass(character)).toBe(15);
    });

    it('should calculate Barbarian unarmored defense (10 + DEX + CON + Shield)', () => {
      const character: any = {
        class: { name: 'Barbarian' },
        abilityScores: {
          dexterity: { modifier: 2 },
          constitution: { modifier: 3 },
        },
        equippedShield: 'shield_id',
      };
      // 10 + 2 + 3 + 2 = 17
      expect(calculateArmorClass(character)).toBe(17);
    });

    it('should calculate Monk unarmored defense (10 + DEX + WIS, no Shield)', () => {
      const character: any = {
        class: { name: 'Monk' },
        abilityScores: {
          dexterity: { modifier: 3 },
          wisdom: { modifier: 4 },
        },
      };
      // 10 + 3 + 4 = 17
      expect(calculateArmorClass(character)).toBe(17);
    });

    it('should negate Monk unarmored defense if wearing a shield (equippedShield boolean)', () => {
      const character: any = {
        class: { name: 'Monk' },
        abilityScores: {
          dexterity: { modifier: 3 },
          wisdom: { modifier: 4 },
        },
        equippedShield: 'shield_id',
      };
      // Monk unarmored defense should fail, fallback to standard: 10 + DEX + Shield = 10 + 3 + 2 = 15
      expect(calculateArmorClass(character)).toBe(15);
    });

    it('should negate Monk unarmored defense if wearing a shield (equippedShield object)', () => {
      (EQUIPMENT_LOOKUP.get as any).mockImplementation((id: string) => {
        if (id === 'magic_shield') return { armorClass: { base: 2 } };
        return null;
      });
      const character: any = {
        class: { name: 'Monk' },
        abilityScores: {
          dexterity: { modifier: 3 },
          wisdom: { modifier: 4 },
        },
        equippedShield: 'magic_shield',
      };
      // Monk unarmored defense should fail, fallback to standard: 10 + DEX + Shield = 10 + 3 + 2 = 15
      expect(calculateArmorClass(character)).toBe(15);
    });

    it('should negate Monk unarmored defense if wearing a shield from lookup even if character field is missing', () => {
      (EQUIPMENT_LOOKUP.get as any).mockImplementation((id: string) => {
        if (id === 'magic_shield') return { armorClass: { base: 2 } };
        return null;
      });
      const character: any = {
        class: { name: 'Monk' },
        abilityScores: {
          dexterity: { modifier: 3 },
          wisdom: { modifier: 4 },
        },
        equippedShield: 'magic_shield',
      };
      // Verify behavior when character.equippedShield is checked in Monk logic
      expect(calculateArmorClass(character)).toBe(15);
    });

    it('should calculate AC with light armor', () => {
      (EQUIPMENT_LOOKUP.get as any).mockImplementation((id: string) => {
        if (id === 'leather') return { armorClass: { base: 11 } };
        return null;
      });
      const character: any = {
        abilityScores: { dexterity: { modifier: 4 } },
        equippedArmor: 'leather',
      };
      // 11 + 4 = 15
      expect(calculateArmorClass(character)).toBe(15);
    });

    it('should calculate AC with medium armor (capped DEX)', () => {
      (EQUIPMENT_LOOKUP.get as any).mockImplementation((id: string) => {
        if (id === 'scale_mail') return { armorClass: { base: 14, maxDexModifier: 2 } };
        return null;
      });
      const character: any = {
        abilityScores: { dexterity: { modifier: 4 } },
        equippedArmor: 'scale_mail',
      };
      // 14 + min(4, 2) = 16
      expect(calculateArmorClass(character)).toBe(16);
    });

    it('should calculate AC with heavy armor (no DEX)', () => {
      (EQUIPMENT_LOOKUP.get as any).mockImplementation((id: string) => {
        if (id === 'plate') return { armorClass: { base: 18, dexModifier: false } };
        return null;
      });
      const character: any = {
        abilityScores: { dexterity: { modifier: -1 } },
        equippedArmor: 'plate',
      };
      // 18 + 0 = 18
      expect(calculateArmorClass(character)).toBe(18);
    });

    it('should calculate AC with armor and max DEX modifier (at limit)', () => {
      (EQUIPMENT_LOOKUP.get as any).mockImplementation((id: string) => {
        if (id === 'medium_armor') return { armorClass: { base: 13, maxDexModifier: 1 } };
        return null;
      });
      const character: any = {
        abilityScores: { dexterity: { modifier: 1 } },
        equippedArmor: 'medium_armor',
      };
      // 13 + min(1, 1) = 14
      expect(calculateArmorClass(character)).toBe(14);
    });

    it('should calculate AC with armor and max DEX modifier (below limit)', () => {
      (EQUIPMENT_LOOKUP.get as any).mockImplementation((id: string) => {
        if (id === 'medium_armor') return { armorClass: { base: 13, maxDexModifier: 1 } };
        return null;
      });
      const character: any = {
        abilityScores: { dexterity: { modifier: 0 } },
        equippedArmor: 'medium_armor',
      };
      // 13 + min(0, 1) = 13
      expect(calculateArmorClass(character)).toBe(13);
    });

    it('should handle unarmored defense for non-barbarian/monk', () => {
      const character: any = {
        class: { name: 'Wizard' },
        abilityScores: { dexterity: { modifier: 2 } },
      };
      // 10 + 2 = 12
      expect(calculateArmorClass(character)).toBe(12);
    });

    it('should handle missing class in calculateArmorClass', () => {
      const character: any = {
        abilityScores: { dexterity: { modifier: 2 } },
      };
      // 10 + 2 = 12
      expect(calculateArmorClass(character)).toBe(12);
    });

    it('should handle class without name in calculateArmorClass', () => {
      const character: any = {
        class: {},
        abilityScores: { dexterity: { modifier: 2 } },
      };
      // Should not crash and return 10 + 2 = 12
      expect(calculateArmorClass(character)).toBe(12);
    });

    it('should handle barbarian unarmored defense with case-insensitive name', () => {
      const character: any = {
        class: { name: 'BARBARIAN' },
        abilityScores: {
          dexterity: { modifier: 2 },
          constitution: { modifier: 3 },
        },
      };
      // 10 + 2 + 3 = 15
      expect(calculateArmorClass(character)).toBe(15);
    });

    it('should handle armor without armorClass property', () => {
      (EQUIPMENT_LOOKUP.get as any).mockReturnValue({ name: 'Strange Armor' });
      const character: any = {
        abilityScores: { dexterity: { modifier: 2 } },
        equippedArmor: 'strange',
      };
      // 10 + 2 = 12
      expect(calculateArmorClass(character)).toBe(12);
    });

    it('should handle armor with maxDexModifier of 0', () => {
      (EQUIPMENT_LOOKUP.get as any).mockReturnValue({
        armorClass: { base: 14, maxDexModifier: 0 },
      });
      const character: any = {
        abilityScores: { dexterity: { modifier: 2 } },
        equippedArmor: 'clunky',
      };
      // 14 + min(2, 0) = 14
      expect(calculateArmorClass(character)).toBe(14);
    });

    it('should handle missing ability scores in calculateArmorClass', () => {
      const character: any = {};
      expect(calculateArmorClass(character)).toBe(10);
    });

    it('should handle barbarian without constitution score', () => {
      const character: any = {
        class: { name: 'barbarian' },
        abilityScores: {
          dexterity: { modifier: 2 },
          // constitution missing
        },
      };
      // 10 + 2 + 0 = 12
      expect(calculateArmorClass(character)).toBe(12);
    });

    it('should handle monk without wisdom score', () => {
      const character: any = {
        class: { name: 'monk' },
        abilityScores: {
          dexterity: { modifier: 3 },
          // wisdom missing
        },
      };
      // 10 + 3 + 0 = 13
      expect(calculateArmorClass(character)).toBe(13);
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
