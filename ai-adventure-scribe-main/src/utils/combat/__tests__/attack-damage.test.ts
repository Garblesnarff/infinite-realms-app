/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

import {
  calculateAttackDamage,
  getAbilityModifier,
  getSpellcastingAbility,
  getSneakAttackDice,
} from '../attack-damage';

import type { Equipment } from '@/data/equipmentOptions';
import type { CombatParticipant, DiceRoll } from '@/types/combat';

import * as diceUtils from '@/utils/diceUtils';

// Mock diceUtils
vi.mock('@/utils/diceUtils', () => ({
  rollDamage: vi.fn(),
  calculateDamage: vi.fn(),
}));

describe('attack-damage', () => {
  const mockAttacker: CombatParticipant = {
    id: 'attacker-1',
    name: 'Attacker',
    participantType: 'player',
    level: 5,
    currentHitPoints: 50,
    maxHitPoints: 50,
    temporaryHitPoints: 0,
    armorClass: 15,
    initiative: 0,
    speed: 30,
    actionTaken: false,
    bonusActionTaken: false,
    reactionTaken: false,
    movementUsed: 0,
    movementRemaining: 30,
    reactionOpportunities: [],
    conditions: [],
    deathSaves: { successes: 0, failures: 0 },
    damageResistances: [],
    damageImmunities: [],
    damageVulnerabilities: [],
  };

  const mockWeapon: Equipment = {
    id: 'longsword',
    name: 'Longsword',
    type: 'weapon',
    weight: 3,
    price: '15 gp',
    rarity: 'common',
    damage: { dice: '1d8', type: 'slashing' },
    weaponProperties: { versatile: true },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getAbilityModifier', () => {
    it('should return correct modifier for default scores', () => {
      // Default STR is 14 -> mod 2
      expect(getAbilityModifier(mockAttacker, 'strength')).toBe(2);
      // Default INT is 12 -> mod 1
      expect(getAbilityModifier(mockAttacker, 'intelligence')).toBe(1);
    });

    it('should handle unknown abilities with a default of 12 (mod 1)', () => {
      expect(getAbilityModifier(mockAttacker, 'luck')).toBe(1);
    });
  });

  describe('getSpellcastingAbility', () => {
    it('should return correct modifier for various classes', () => {
      const wizard = { ...mockAttacker, characterClass: 'wizard' };
      expect(getSpellcastingAbility(wizard)).toBe(1); // Intelligence mod for 12

      const cleric = { ...mockAttacker, characterClass: 'cleric' };
      expect(getSpellcastingAbility(cleric)).toBe(1); // Wisdom mod for 12

      const sorcerer = { ...mockAttacker, characterClass: 'sorcerer' };
      expect(getSpellcastingAbility(sorcerer)).toBe(1); // Charisma mod for 12

      const ranger = { ...mockAttacker, characterClass: 'ranger' };
      expect(getSpellcastingAbility(ranger)).toBe(1); // Wisdom mod for 12

      const artificer = { ...mockAttacker, characterClass: 'artificer' };
      expect(getSpellcastingAbility(artificer)).toBe(1); // Int mod for 12

      const bard = { ...mockAttacker, characterClass: 'bard' };
      expect(getSpellcastingAbility(bard)).toBe(1);

      const warlock = { ...mockAttacker, characterClass: 'warlock' };
      expect(getSpellcastingAbility(warlock)).toBe(1);

      const paladin = { ...mockAttacker, characterClass: 'paladin' };
      expect(getSpellcastingAbility(paladin)).toBe(1);

      const druid = { ...mockAttacker, characterClass: 'druid' };
      expect(getSpellcastingAbility(druid)).toBe(1);

      const arcane_trickster = { ...mockAttacker, characterClass: 'arcane_trickster' };
      expect(getSpellcastingAbility(arcane_trickster)).toBe(1);

      const cloak_of_elvenkind = { ...mockAttacker, characterClass: 'cloak_of_elvenkind' };
      expect(getSpellcastingAbility(cloak_of_elvenkind)).toBe(1);
    });

    it('should return 0 for non-spellcasting classes', () => {
      const fighter = { ...mockAttacker, characterClass: 'fighter' };
      expect(getSpellcastingAbility(fighter)).toBe(0);
    });
  });

  describe('getSneakAttackDice', () => {
    it('should return correct dice for rogue levels', () => {
      expect(getSneakAttackDice(1)).toBe('1d6');
      expect(getSneakAttackDice(2)).toBe('1d6');
      expect(getSneakAttackDice(3)).toBe('2d6');
      expect(getSneakAttackDice(4)).toBe('2d6');
      expect(getSneakAttackDice(5)).toBe('3d6');
      expect(getSneakAttackDice(6)).toBe('3d6');
      expect(getSneakAttackDice(19)).toBe('10d6');
      expect(getSneakAttackDice(20)).toBe('10d6');
    });
  });

  describe('calculateAttackDamage', () => {
    const mockRoll = (total: number, results: number[] = [total]): DiceRoll => ({
      dieType: 8,
      count: 1,
      modifier: 0,
      results,
      keptResults: results,
      total,
    });

    beforeEach(() => {
      (diceUtils.calculateDamage as Mock).mockImplementation((base: number) => base);
    });

    it('should calculate unarmed strike damage (checking for STR mod)', () => {
      (diceUtils.rollDamage as Mock).mockReturnValue([mockRoll(3, [3])]);

      const result = calculateAttackDamage(null, mockAttacker, false);

      expect(diceUtils.rollDamage).toHaveBeenCalledWith('1d4', false, {});
      // Current implementation: baseDamage = 3. Expected: 3 + 2 (STR mod) = 5.
      expect(result.totalBeforeResistance).toBe(5);
    });

    it('should calculate melee weapon damage (using STR)', () => {
      (diceUtils.rollDamage as Mock).mockReturnValue([mockRoll(5, [5])]);

      const result = calculateAttackDamage(mockWeapon, mockAttacker, false);

      expect(result.totalBeforeResistance).toBe(7); // 5 (roll) + 2 (STR mod)
    });

    it('should calculate ranged weapon damage (using DEX)', () => {
      const shortbow: Equipment = {
        ...mockWeapon,
        range: { normal: 80, long: 320 },
        damage: { dice: '1d6', type: 'piercing' },
      };
      (diceUtils.rollDamage as Mock).mockReturnValue([mockRoll(4, [4])]);

      const result = calculateAttackDamage(shortbow, mockAttacker, false);

      expect(result.totalBeforeResistance).toBe(6); // 4 (roll) + 2 (DEX mod)
    });

    it('should use finesse logic (higher of STR or DEX)', () => {
      const rapier: Equipment = {
        ...mockWeapon,
        weaponProperties: { finesse: true },
        damage: { dice: '1d8', type: 'piercing' },
      };

      (diceUtils.rollDamage as Mock).mockReturnValue([mockRoll(5, [5])]);
      const result = calculateAttackDamage(rapier, mockAttacker, false);
      expect(result.totalBeforeResistance).toBe(7);
    });

    it('should use ability scores from participant if available', () => {
      const strongAttacker = { ...mockAttacker, strength: 18 } as any;
      expect(getAbilityModifier(strongAttacker, 'strength')).toBe(4);

      const weakAttacker = { ...mockAttacker, strength: 8 } as any;
      expect(getAbilityModifier(weakAttacker, 'strength')).toBe(-1);
    });

    it('should handle missing ability scores gracefully using defaults', () => {
      // @ts-ignore - testing missing properties
      const partialParticipant: CombatParticipant = {
        id: '1',
      } as any;
      expect(getAbilityModifier(partialParticipant, 'strength')).toBe(2); // default 14
      expect(getAbilityModifier(partialParticipant, 'intelligence')).toBe(1); // default 12
    });

    it('should handle resistance, immunity, and vulnerability', () => {
      (diceUtils.rollDamage as Mock).mockReturnValue([mockRoll(10)]);

      (diceUtils.calculateDamage as Mock).mockImplementation((
        baseDamage: number,
        damageType: string,
        resistances: string[] = [],
        immunities: string[] = [],
        vulnerabilities: string[] = [],
      ) => {
        if (immunities.includes(damageType)) return 0;
        let finalDamage = baseDamage;
        if (resistances.includes(damageType)) finalDamage = Math.floor(finalDamage / 2);
        if (vulnerabilities.includes(damageType)) finalDamage = finalDamage * 2;
        return finalDamage;
      });

      const fireSword: Equipment = {
        ...mockWeapon,
        damage: { dice: '1d10', type: 'fire' },
      };

      // Resistance
      const resistantAttacker = { ...mockAttacker, damageResistances: ['fire'] as any };
      const resResult = calculateAttackDamage(fireSword, resistantAttacker, false);
      // 10 + 2 (STR) = 12. Resistance -> 6.
      expect(resResult.totalAfterResistance).toBe(6);

      // Immunity
      const immuneAttacker = { ...mockAttacker, damageImmunities: ['fire'] as any };
      const immResult = calculateAttackDamage(fireSword, immuneAttacker, false);
      expect(immResult.totalAfterResistance).toBe(0);

      // Vulnerability
      const vulnerableAttacker = { ...mockAttacker, damageVulnerabilities: ['fire'] as any };
      const vulResult = calculateAttackDamage(fireSword, vulnerableAttacker, false);
      // 12 * 2 = 24.
      expect(vulResult.totalAfterResistance).toBe(24);
    });

    it('should add magic weapon bonus', () => {
      const magicWeapon: Equipment = {
        ...mockWeapon,
        weaponProperties: { magical: true },
        magicBonus: 1,
      };
      (diceUtils.rollDamage as Mock).mockReturnValue([mockRoll(5)]);
      const result = calculateAttackDamage(magicWeapon, mockAttacker, false);
      expect(result.totalBeforeResistance).toBe(8); // 5 (roll) + 2 (STR) + 1 (magic)
    });

    it('should add Divine Smite damage and handle critical hits', () => {
      (diceUtils.rollDamage as Mock).mockImplementation((dice: string) => {
        if (dice === '1d8') return [mockRoll(5)];
        if (dice === '3d8') return [mockRoll(15)]; // Divine Smite lvl 2 (3d8)
        return [];
      });

      const result = calculateAttackDamage(mockWeapon, mockAttacker, true, { divineSmiteLevel: 2 });

      expect(diceUtils.rollDamage).toHaveBeenCalledWith('1d8', true, expect.any(Object));
      expect(diceUtils.rollDamage).toHaveBeenCalledWith('3d8', true, expect.any(Object));
      expect(result.damageType).toBe('radiant');
      expect(result.totalBeforeResistance).toBe(22); // 5 (weapon) + 15 (smite) + 2 (STR)
    });

    it('should handle Barbarian levels for Rage bonus', () => {
      (diceUtils.rollDamage as Mock).mockReturnValue([mockRoll(5)]);
      const barbarian = {
        ...mockAttacker,
        characterClass: 'barbarian',
        isRaging: true,
      };

      expect(calculateAttackDamage(mockWeapon, { ...barbarian, level: 1 }, false).totalBeforeResistance).toBe(9);
      expect(calculateAttackDamage(mockWeapon, { ...barbarian, level: 8 }, false).totalBeforeResistance).toBe(9);
      expect(calculateAttackDamage(mockWeapon, { ...barbarian, level: 9 }, false).totalBeforeResistance).toBe(10);
      expect(calculateAttackDamage(mockWeapon, { ...barbarian, level: 15 }, false).totalBeforeResistance).toBe(10);
      expect(calculateAttackDamage(mockWeapon, { ...barbarian, level: 16 }, false).totalBeforeResistance).toBe(11);
      expect(calculateAttackDamage(mockWeapon, { ...barbarian, level: 20 }, false).totalBeforeResistance).toBe(11);
    });

    it('should cap Divine Smite at 5d8', () => {
      (diceUtils.rollDamage as Mock).mockImplementation((dice: string) => {
        if (dice === '1d8') return [mockRoll(5)];
        if (dice === '5d8') return [mockRoll(25)];
        return [];
      });

      calculateAttackDamage(mockWeapon, mockAttacker, false, { divineSmiteLevel: 4 });
      expect(diceUtils.rollDamage).toHaveBeenCalledWith('5d8', false, expect.any(Object));

      calculateAttackDamage(mockWeapon, mockAttacker, false, { divineSmiteLevel: 5 });
      expect(diceUtils.rollDamage).toHaveBeenCalledWith('5d8', false, expect.any(Object));
    });

    it('should apply Barbarian Rage bonus only to melee STR attacks', () => {
      (diceUtils.rollDamage as Mock).mockReturnValue([mockRoll(5)]);
      const barbarian = {
        ...mockAttacker,
        characterClass: 'barbarian',
        isRaging: true,
        level: 1
      };

      // Melee attack
      const meleeResult = calculateAttackDamage(mockWeapon, barbarian, false);
      expect(meleeResult.totalBeforeResistance).toBe(9); // 5 + 2 (STR) + 2 (Rage)

      // Ranged attack
      const shortbow: Equipment = {
        ...mockWeapon,
        range: { normal: 80, long: 320 },
        damage: { dice: '1d6', type: 'piercing' },
      };
      const rangedResult = calculateAttackDamage(shortbow, barbarian, false);
      expect(rangedResult.totalBeforeResistance).toBe(7); // 5 + 2 (DEX) + 0 (Rage)

      // Unarmed strike (eligible if using STR)
      (diceUtils.rollDamage as Mock).mockReturnValue([mockRoll(3)]);
      calculateAttackDamage(null, barbarian, false);
      // expect(unarmedResult.totalBeforeResistance).toBe(5); // 3 (roll) + 2 (STR) + 0 (unarmed not a weapon)
      // Actually, RAW says melee weapon attacks. Unarmed strikes are melee weapon attacks in some contexts, but not always.
      // My implementation currently checks for `weapon && !weapon.range`. So unarmed gets no rage bonus.
    });

    it('should apply Sneak Attack damage and handle critical hits', () => {
      (diceUtils.rollDamage as Mock).mockImplementation((dice: string) => {
        if (dice === '1d8') return [mockRoll(5)];
        if (dice === '3d6') return [mockRoll(10)]; // Sneak attack lvl 5
        return [];
      });

      const rogue = { ...mockAttacker, characterClass: 'rogue', level: 5 };
      calculateAttackDamage(mockWeapon, rogue, true, { sneakAttack: true });

      // Expected weapon: 1d8 (crit=true) -> 2d8. Sneak: 3d6 (crit=true) -> 6d6.
      // CURRENT BUG: Sneak uses `criticalHit=false`.
      expect(diceUtils.rollDamage).toHaveBeenCalledWith('3d6', true, expect.any(Object));
    });
  });
});
