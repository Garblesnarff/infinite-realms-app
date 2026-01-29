/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable import/order */
/* eslint-disable max-lines */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

import type { Equipment } from '@/data/equipmentOptions';
import type { CombatParticipant, DiceRoll } from '@/types/combat';

import {
  resolveAttack,
  calculateAttackDamage,
  getNumberOfAttacks,
  canUseSneakAttack,
  performAttack,
  createCombatActionFromAttack,
  type FullAttackResult
} from '../attackUtils';
import * as characterCalculations from '../character-calculations';
import * as diceUtils from '../diceUtils';

// Mock the dependencies
vi.mock('../diceUtils', () => ({
  rollAttack: vi.fn(),
  rollDamage: vi.fn(),
  calculateDamage: vi.fn(),
}));

vi.mock('../character-calculations', () => ({
  calculateProficiencyBonus: vi.fn(),
}));

describe('attackUtils', () => {
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

  const mockTarget: CombatParticipant = {
    id: 'target-1',
    name: 'Target',
    participantType: 'enemy',
    currentHitPoints: 30,
    maxHitPoints: 30,
    temporaryHitPoints: 0,
    armorClass: 14,
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
    (characterCalculations.calculateProficiencyBonus as Mock).mockReturnValue(3);
  });

  describe('resolveAttack', () => {
    it('should return a hit when the roll meets or exceeds AC', () => {
      const mockRoll: DiceRoll = {
        dieType: 20, count: 1, modifier: 5, results: [10], keptResults: [10], total: 15, naturalRoll: 10,
      };
      (diceUtils.rollAttack as Mock).mockReturnValue(mockRoll);

      const result = resolveAttack(mockWeapon, mockAttacker, mockTarget);

      expect(result.hit).toBe(true);
      expect(result.roll.total).toBe(15);
      expect(result.acHit).toBe(14);
    });

    it('should return a miss when the roll is below AC', () => {
      const mockRoll: DiceRoll = {
        dieType: 20, count: 1, modifier: 5, results: [5], keptResults: [5], total: 10, naturalRoll: 5,
      };
      (diceUtils.rollAttack as Mock).mockReturnValue(mockRoll);

      const result = resolveAttack(mockWeapon, mockAttacker, mockTarget);

      expect(result.hit).toBe(false);
    });

    it('should return a critical hit on natural 20', () => {
      const mockRoll: DiceRoll = {
        dieType: 20, count: 1, modifier: 5, results: [20], keptResults: [20], total: 25, naturalRoll: 20,
      };
      (diceUtils.rollAttack as Mock).mockReturnValue(mockRoll);

      const result = resolveAttack(mockWeapon, mockAttacker, mockTarget);

      expect(result.hit).toBe(true);
      expect(result.criticalHit).toBe(true);
    });

    it('should return a critical fail on natural 1 (automatic miss)', () => {
      const mockRoll: DiceRoll = {
        dieType: 20, count: 1, modifier: 20, results: [1], keptResults: [1], total: 21, naturalRoll: 1,
      };
      (diceUtils.rollAttack as Mock).mockReturnValue(mockRoll);

      const result = resolveAttack(mockWeapon, mockAttacker, mockTarget);

      expect(result.hit).toBe(false);
      expect(result.criticalFail).toBe(true);
    });

    it('should handle spell attacks for various classes', () => {
      const classes = ['wizard', 'sorcerer', 'cleric', 'paladin', 'ranger', 'druid', 'bard', 'warlock', 'artificer', 'arcane_trickster', 'cloak_of_elvenkind'];
      (diceUtils.rollAttack as Mock).mockReturnValue({ total: 20 });

      classes.forEach(cls => {
        const attacker = { ...mockAttacker, characterClass: cls };
        resolveAttack(null, attacker, mockTarget, { spellAttack: true });
        expect(diceUtils.rollAttack).toHaveBeenCalled();
      });
    });

    it('should apply advantage for various target conditions', () => {
      const conditions = ['blinded', 'prone', 'paralyzed', 'stunned', 'unconscious'];
      (diceUtils.rollAttack as Mock).mockReturnValue({ total: 20 });
      conditions.forEach(cond => {
        const target = { ...mockTarget, conditions: [{ name: cond as any, description: '', duration: -1 }] };
        resolveAttack(mockWeapon, mockAttacker, target);
        expect(diceUtils.rollAttack).toHaveBeenLastCalledWith(expect.any(Number), expect.objectContaining({ advantage: true }));
      });
    });
  });

  describe('calculateAttackDamage', () => {
    it('should calculate base weapon damage correctly', () => {
      const mockRolls: DiceRoll[] = [{
        dieType: 8, count: 1, modifier: 0, results: [5], keptResults: [5], total: 5,
      }];
      (diceUtils.rollDamage as Mock).mockReturnValue(mockRolls);
      (diceUtils.calculateDamage as Mock).mockImplementation((base: number) => base);

      const result = calculateAttackDamage(mockWeapon, mockAttacker, false);

      expect(result.totalBeforeResistance).toBe(7); // 5 (roll) + 2 (strength mod default)
      expect(result.damageType).toBe('slashing');
    });

    it('should handle critical hits by passing the critical flag to rollDamage', () => {
      (diceUtils.rollDamage as Mock).mockReturnValue([{ total: 10, results: [5, 5], modifier: 0, count: 2 }]);
      calculateAttackDamage(mockWeapon, mockAttacker, true);
      expect(diceUtils.rollDamage).toHaveBeenCalledWith('1d8', true, expect.any(Object));
    });

    it('should calculate damage for different barbarian levels (Rage bonus)', () => {
      const rageBonusTests = [
        { level: 1, expected: 9 }, // 5 (roll) + 2 (str) + 2 (rage)
        { level: 9, expected: 10 }, // 5 + 2 + 3
        { level: 16, expected: 11 }, // 5 + 2 + 4
      ];

      (diceUtils.calculateDamage as Mock).mockImplementation((base: number) => base);

      rageBonusTests.forEach(test => {
        (diceUtils.rollDamage as Mock).mockReturnValue([{ total: 5, count: 1, modifier: 0, results: [5] }]);
        const attacker = { ...mockAttacker, characterClass: 'barbarian', isRaging: true, level: test.level };
        const result = calculateAttackDamage(mockWeapon, attacker, false);
        expect(result.totalBeforeResistance).toBe(test.expected);
      });
    });

    it('should calculate sneak attack damage for various levels', () => {
      const sneakDiceTests = [
        { level: 1, expected: '1d6' },
        { level: 3, expected: '2d6' },
        { level: 5, expected: '3d6' },
      ];
      (diceUtils.calculateDamage as Mock).mockImplementation(b => b);
      sneakDiceTests.forEach(test => {
        (diceUtils.rollDamage as Mock).mockReturnValue([{ total: 1, results: [1], modifier: 0, count: 1 }]);
        const rogue = { ...mockAttacker, characterClass: 'rogue', level: test.level };
        calculateAttackDamage(mockWeapon, rogue, false, { sneakAttack: true });
        expect(diceUtils.rollDamage).toHaveBeenLastCalledWith(test.expected, false, {});
      });
    });
  });

  describe('performAttack', () => {
    it('should execute both resolution and damage calculation on a hit', () => {
      const attackRoll: DiceRoll = {
        dieType: 20, count: 1, modifier: 5, results: [15], keptResults: [15], total: 20, naturalRoll: 15,
      };
      const damageRoll: DiceRoll = {
        dieType: 8, count: 1, modifier: 0, results: [6], keptResults: [6], total: 6,
      };

      (diceUtils.rollAttack as Mock).mockReturnValue(attackRoll);
      (diceUtils.rollDamage as Mock).mockReturnValue([damageRoll]);
      (diceUtils.calculateDamage as Mock).mockImplementation((base: number) => base);

      const result = performAttack(mockWeapon, mockAttacker, mockTarget);

      expect(result.resolution.hit).toBe(true);
      expect(result.damage).not.toBeNull();
      expect(result.totalDamageDealt).toBe(8); // 6 (roll) + 2 (str mod)
      expect(result.targetReducedHp).toBe(22); // 30 - 8
    });

    it('should return no damage on a miss (including critical fail)', () => {
      const attackRoll: DiceRoll = {
        dieType: 20, count: 1, modifier: 20, results: [1], keptResults: [1], total: 21, naturalRoll: 1,
      };
      (diceUtils.rollAttack as Mock).mockReturnValue(attackRoll);

      const result = performAttack(mockWeapon, mockAttacker, mockTarget);

      expect(result.resolution.hit).toBe(false);
      expect(result.damage).toBeNull();
    });
  });

  describe('getNumberOfAttacks', () => {
    it('should return correct number based on class and level', () => {
      expect(getNumberOfAttacks(null, 'fighter', 1)).toBe(1);
      expect(getNumberOfAttacks(null, 'fighter', 5)).toBe(2);
      expect(getNumberOfAttacks(null, 'fighter', 11)).toBe(3);
      expect(getNumberOfAttacks(null, 'rogue', 5)).toBe(2);
      expect(getNumberOfAttacks(null, 'wizard', 5)).toBe(1);
    });
  });

  describe('canUseSneakAttack', () => {
    it('should return true if the rogue has advantage', () => {
      const rogue = { ...mockAttacker, characterClass: 'rogue' };
      const proneTarget = {
        ...mockTarget,
        conditions: [{ name: 'prone' as const, description: '', duration: -1 }],
      };
      expect(canUseSneakAttack(rogue, proneTarget)).toBe(true);
    });

    it('should return true if an ally is nearby', () => {
      const rogue = { ...mockAttacker, characterClass: 'rogue' };
      const ally = { ...mockAttacker, id: 'ally-1' };
      expect(canUseSneakAttack(rogue, mockTarget, [rogue, ally, mockTarget])).toBe(true);
    });
  });

  describe('createCombatActionFromAttack', () => {
    it('should create a correctly formatted combat action', () => {
      const attackRoll: DiceRoll = {
        dieType: 20, count: 1, modifier: 5, results: [15], keptResults: [15], total: 20, naturalRoll: 15,
      };
      const damageRoll: DiceRoll = {
        dieType: 8, count: 1, modifier: 0, results: [6], keptResults: [6], total: 6,
      };
      const attackResult = {
        resolution: { hit: true, roll: attackRoll, acHit: 14, criticalHit: false, criticalFail: false, advantage: false, disadvantage: false },
        damage: { rolls: [damageRoll], totalBeforeResistance: 8, totalAfterResistance: 8, damageType: 'slashing' as const, resistances: [], vulnerabilities: [], immunities: [] },
        totalDamageDealt: 8,
      };

      const action = createCombatActionFromAttack(mockAttacker, mockTarget, mockWeapon, attackResult as unknown as FullAttackResult);

      expect(action.hit).toBe(true);
      expect(action.description).toContain('hits');
    });
  });
});
