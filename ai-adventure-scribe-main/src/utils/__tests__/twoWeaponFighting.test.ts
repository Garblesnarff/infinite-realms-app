/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  canUseTwoWeaponFighting,
  makeMainHandAttack,
  makeOffHandAttack,
  calculateTwoWeaponAttacks,
  getTwoWeaponAttackSequence,
} from '../twoWeaponFighting';

import type { CombatParticipant } from '@/types/combat';

import * as diceUtils from '@/utils/diceUtils';

// Mock diceUtils
vi.mock('@/utils/diceUtils', () => ({
  rollAttack: vi.fn(),
  rollDamage: vi.fn(),
  rollDice: vi.fn(),
}));

describe('twoWeaponFighting', () => {
  const mockLightWeapon: any = {
    name: 'Shortsword',
    weaponProperties: { light: true, finesse: true },
    damage: { dice: '1d6', type: 'piercing' },
  };

  const mockNonLightWeapon: any = {
    name: 'Longsword',
    weaponProperties: { light: false },
    damage: { dice: '1d8', type: 'slashing' },
  };

  const mockShield: any = {
    name: 'Shield',
    category: 'shield',
  };

  const baseParticipant: Partial<CombatParticipant> = {
    id: 'p1',
    name: 'Hero',
    level: 1,
    bonusActionTaken: false,
    actionTaken: false,
    fightingStyles: [],
  };

  // Add ability scores to match the runtime check in twoWeaponFighting.ts
  const participantWithAbilities: any = {
    ...baseParticipant,
    abilityScores: {
      strength: { modifier: 3 },
      dexterity: { modifier: 2 },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('canUseTwoWeaponFighting', () => {
    it('should return false if main hand is empty', () => {
      const p = {
        ...baseParticipant,
        mainHandWeapon: undefined,
        offHandWeapon: mockLightWeapon,
      } as any;
      expect(canUseTwoWeaponFighting(p)).toBe(false);
    });

    it('should return false if off hand is empty', () => {
      const p = {
        ...baseParticipant,
        mainHandWeapon: mockLightWeapon,
        offHandWeapon: undefined,
      } as any;
      expect(canUseTwoWeaponFighting(p)).toBe(false);
    });

    it('should return true if both weapons are light', () => {
      const p = {
        ...baseParticipant,
        mainHandWeapon: mockLightWeapon,
        offHandWeapon: mockLightWeapon,
      } as any;
      expect(canUseTwoWeaponFighting(p)).toBe(true);
    });

    it('should return false if one weapon is not light', () => {
      const p = {
        ...baseParticipant,
        mainHandWeapon: mockNonLightWeapon,
        offHandWeapon: mockLightWeapon,
      } as any;
      expect(canUseTwoWeaponFighting(p)).toBe(false);
    });

    it('should return false if off-hand is a shield (by category)', () => {
      const p = {
        ...baseParticipant,
        mainHandWeapon: mockLightWeapon,
        offHandWeapon: mockShield,
      } as any;
      expect(canUseTwoWeaponFighting(p)).toBe(false);
    });

    it('should return false if off-hand is a shield (by name)', () => {
      const shieldByName = { name: 'Wooden Shield', category: 'armor' };
      const p = {
        ...baseParticipant,
        mainHandWeapon: mockLightWeapon,
        offHandWeapon: shieldByName,
      } as any;
      expect(canUseTwoWeaponFighting(p)).toBe(false);
    });

    it('should return false if off-hand is a focus', () => {
      const focus = { name: 'Arcane Focus', subcategory: 'Focus' };
      const p = {
        ...baseParticipant,
        mainHandWeapon: mockLightWeapon,
        offHandWeapon: focus,
      } as any;
      expect(canUseTwoWeaponFighting(p)).toBe(false);
    });

    it('should return false if bonus action is taken', () => {
      const p = {
        ...baseParticipant,
        mainHandWeapon: mockLightWeapon,
        offHandWeapon: mockLightWeapon,
        bonusActionTaken: true,
      } as any;
      expect(canUseTwoWeaponFighting(p)).toBe(false);
    });
  });

  describe('makeMainHandAttack', () => {
    it('should throw error if main hand weapon is missing', () => {
      const p = { ...baseParticipant, mainHandWeapon: undefined } as any;
      expect(() => makeMainHandAttack(p)).toThrow('No main hand weapon equipped');
    });

    it('should calculate attack and damage with ability modifier', () => {
      const p = {
        ...participantWithAbilities,
        mainHandWeapon: mockLightWeapon,
      } as any;

      const mockAttackRoll = { total: 15, critical: false };
      const mockDamageRoll = [{ keptResults: [4], modifier: 0 }];

      (diceUtils.rollAttack as any).mockReturnValue(mockAttackRoll);
      (diceUtils.rollDamage as any).mockReturnValue(mockDamageRoll);

      const action = makeMainHandAttack(p);

      // DEX modifier is 2 (finesse), proficiency is 2 (level 1)
      // Total attack bonus should be 4
      expect(diceUtils.rollAttack).toHaveBeenCalledWith(4, expect.any(Object));

      // Total damage = 4 (roll) + 2 (DEX mod) = 6
      expect(action.damageDealt).toBe(6);
    });

    it('should use STR if weapon is not finesse', () => {
      const mockStrWeapon: any = {
        name: 'Handaxe',
        weaponProperties: { light: true, finesse: false },
        damage: { dice: '1d6', type: 'slashing' },
      };
      const p = {
        ...participantWithAbilities,
        mainHandWeapon: mockStrWeapon,
      } as any;

      (diceUtils.rollAttack as any).mockReturnValue({ total: 10, critical: false });
      (diceUtils.rollDamage as any).mockReturnValue([{ keptResults: [3], modifier: 0 }]);

      makeMainHandAttack(p);

      // STR modifier is 3, proficiency is 2. Total = 5.
      expect(diceUtils.rollAttack).toHaveBeenCalledWith(5, expect.any(Object));
    });

    it('should return 0 modifier if abilityScores is missing', () => {
      const p = {
        ...baseParticipant,
        mainHandWeapon: mockLightWeapon,
      } as any;

      (diceUtils.rollAttack as any).mockReturnValue({ total: 10, critical: false });
      (diceUtils.rollDamage as any).mockReturnValue([{ keptResults: [3], modifier: 0 }]);

      makeMainHandAttack(p);

      // Proficiency is 2, ability mod is 0. Total = 2.
      expect(diceUtils.rollAttack).toHaveBeenCalledWith(2, expect.any(Object));
    });
  });

  describe('makeOffHandAttack', () => {
    it('should throw error if off hand weapon is missing', () => {
      const p = { ...baseParticipant, offHandWeapon: undefined } as any;
      expect(() => makeOffHandAttack(p)).toThrow('No off-hand weapon equipped');
    });

    it('should NOT add ability modifier to damage by default', () => {
      const p = {
        ...participantWithAbilities,
        offHandWeapon: mockLightWeapon,
      } as any;

      (diceUtils.rollAttack as any).mockReturnValue({ total: 15, critical: false });
      (diceUtils.rollDamage as any).mockReturnValue([{ keptResults: [4], modifier: 0 }]);

      const action = makeOffHandAttack(p);

      // Damage should only be the roll result (4)
      expect(action.damageDealt).toBe(4);
    });

    it('should add ability modifier to damage if participant has Two-Weapon Fighting style', () => {
      const p = {
        ...participantWithAbilities,
        offHandWeapon: mockLightWeapon,
        fightingStyles: [{ name: 'two_weapon_fighting' }],
      } as any;

      (diceUtils.rollAttack as any).mockReturnValue({ total: 15, critical: false });
      (diceUtils.rollDamage as any).mockReturnValue([{ keptResults: [4], modifier: 0 }]);

      const action = makeOffHandAttack(p);

      // Damage = 4 (roll) + 2 (DEX mod) = 6
      expect(action.damageDealt).toBe(6);
    });

    it('should return 0 modifier if abilityScores is missing', () => {
      const p = {
        ...baseParticipant,
        offHandWeapon: mockLightWeapon,
      } as any;

      (diceUtils.rollAttack as any).mockReturnValue({ total: 10, critical: false });
      (diceUtils.rollDamage as any).mockReturnValue([{ keptResults: [3], modifier: 0 }]);

      makeOffHandAttack(p);

      // Proficiency is 2, ability mod is 0. Total = 2.
      expect(diceUtils.rollAttack).toHaveBeenCalledWith(2, expect.any(Object));
    });
  });

  describe('calculateTwoWeaponAttacks', () => {
    it('should return 1 main and 1 off attack for level 1 fighter', () => {
      const p = {
        ...baseParticipant,
        characterClass: 'fighter',
        level: 1,
        mainHandWeapon: mockLightWeapon,
        offHandWeapon: mockLightWeapon,
      } as any;
      const result = calculateTwoWeaponAttacks(p);
      expect(result.mainHandAttacks).toBe(1);
      expect(result.offHandAttacks).toBe(1);
    });

    it('should return 2 main attacks for level 5 fighter', () => {
      const p = {
        ...baseParticipant,
        characterClass: 'fighter',
        level: 5,
        mainHandWeapon: mockLightWeapon,
        offHandWeapon: mockLightWeapon,
      } as any;
      const result = calculateTwoWeaponAttacks(p);
      expect(result.mainHandAttacks).toBe(2);
      expect(result.offHandAttacks).toBe(1);
    });

    it('should include Action Surge for fighters', () => {
      const p = {
        ...baseParticipant,
        characterClass: 'fighter',
        level: 2,
        resources: { action_surge: { currentUses: 1 } },
        mainHandWeapon: mockLightWeapon,
        offHandWeapon: mockLightWeapon,
      } as any;
      const result = calculateTwoWeaponAttacks(p);
      expect(result.mainHandAttacks).toBe(2); // 1 base + 1 action surge
    });
  });

  describe('getTwoWeaponAttackSequence', () => {
    it('should return correct sequence for level 5 fighter', () => {
      const p = {
        ...baseParticipant,
        characterClass: 'fighter',
        level: 5,
        mainHandWeapon: mockLightWeapon,
        offHandWeapon: mockLightWeapon,
      } as any;
      const sequence = getTwoWeaponAttackSequence(p);
      expect(sequence).toEqual(['main_hand', 'main_hand', 'off_hand']);
    });
  });
});
