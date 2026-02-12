/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  calculateArmyStrength,
  calculateArmyDamage,
  resolveArmyAttack,
  checkArmyMorale,
  moveArmy,
  isBattleEnded,
  executeTacticalManeuver,
  simulateCombatRound,
  calculateCasualties,
  resupplyArmy,
  calculateStrategicPoints,
  createDefaultCombatResult,
} from '../massCombat';

import type { Army, Battlefield, ArmyCommander, TacticalManeuver } from '@/types/massCombat';

import { rollDice } from '@/utils/diceUtils';

vi.mock('@/utils/diceUtils', () => ({
  rollDice: vi.fn(),
}));

describe('massCombat utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('calculateArmyStrength', () => {
    it('should calculate total strength correctly', () => {
      const army: Partial<Army> = {
        units: [
          { size: 100, hitPoints: 10 } as any,
          { size: 50, hitPoints: 20 } as any,
        ],
      };
      expect(calculateArmyStrength(army as Army)).toBe(2000);
    });

    it('should return 0 for army with no units', () => {
      const army: Partial<Army> = { units: [] };
      expect(calculateArmyStrength(army as Army)).toBe(0);
    });
  });

  describe('calculateArmyDamage', () => {
    it('should parse dice notation and calculate damage correctly', () => {
      (rollDice as any).mockReturnValue({ total: 10 });
      const attack = { damage: '2d6+2' } as any;
      const targetUnit = { armorClass: 12 } as any;

      const damage = calculateArmyDamage(attack, targetUnit);

      expect(rollDice).toHaveBeenCalledWith(6, 2, 2);
      // armorProtection = max(0, 12 - 10) = 2
      // damage = max(1, 10 - 2) = 8
      expect(damage).toBe(8);
    });

    it('should handle negative modifiers in dice notation', () => {
      (rollDice as any).mockReturnValue({ total: 5 });
      const attack = { damage: '1d8-1' } as any;
      const targetUnit = { armorClass: 10 } as any;

      const damage = calculateArmyDamage(attack, targetUnit);

      expect(rollDice).toHaveBeenCalledWith(8, 1, -1);
      expect(damage).toBe(5); // armorProtection = 0
    });

    it('should ensure minimum damage of 1', () => {
      (rollDice as any).mockReturnValue({ total: 2 });
      const attack = { damage: '1d4' } as any;
      const targetUnit = { armorClass: 15 } as any;

      const damage = calculateArmyDamage(attack, targetUnit);

      // armorProtection = 5
      // 2 - 5 = -3, max(1, -3) = 1
      expect(damage).toBe(1);
    });
  });

  describe('resolveArmyAttack', () => {
    it('should return miss description if attack fails to hit', () => {
      (rollDice as any).mockReturnValue({ total: 10 }); // toHitRoll
      const attacker = { name: 'Attacker' } as any;
      const defender = { name: 'Defender', armorClass: 15 } as any;
      const attack = { attackBonus: 2 } as any;

      const result = resolveArmyAttack(attacker, defender, attack);

      expect(result.damage).toBe(0);
      expect(result.casualties).toBe(0);
      expect(result.description).toContain('misses');
    });

    it('should calculate damage and casualties on a hit', () => {
      // Mock toHitRoll (hits) then damage roll
      (rollDice as any)
        .mockReturnValueOnce({ total: 18 }) // toHitRoll
        .mockReturnValueOnce({ total: 25 }); // damageRoll

      const attacker = { name: 'Attacker' } as any;
      const defender = { name: 'Defender', armorClass: 15, hitPoints: 10, size: 100 } as any;
      const attack = { attackBonus: 5, damage: '3d8' } as any;

      const result = resolveArmyAttack(attacker, defender, attack);

      // armorProtection = 15 - 10 = 5
      // damage = 25 - 5 = 20
      // casualties = floor(20 / 10) = 2
      expect(result.damage).toBe(20);
      expect(result.casualties).toBe(2);
      expect(result.description).toContain('hits Defender for 20 damage, causing 2 casualties');
    });
  });

  describe('checkArmyMorale', () => {
    it('should return breaks: true if morale check fails', () => {
      // casualtyPercentage = (20 / 100) * 100 = 20
      // moraleDC = 10 + floor(20/10) = 12
      // armyMorale = (10 + 10) / 2 = 10
      // moraleRoll = rollDice(20, 1, floor(10/2)) = rollDice(20, 1, 5)
      (rollDice as any).mockReturnValue({ total: 11 });

      const army = {
        name: 'test army',
        units: [
          { size: 50, morale: 10 },
          { size: 50, morale: 10 },
        ],
      } as any;

      const result = checkArmyMorale(army, 20);

      expect(result.breaks).toBe(true);
      expect(result.moraleChange).toBe(-2);
      expect(result.description).toContain('breaks and begins to rout');
    });

    it('should return breaks: false if morale check succeeds', () => {
      (rollDice as any).mockReturnValue({ total: 20 });

      const army = {
        name: 'test army',
        units: [{ size: 100, morale: 10 }],
      } as any;

      const result = checkArmyMorale(army, 5);

      expect(result.breaks).toBe(false);
      expect(result.moraleChange).toBe(1);
      expect(result.description).toContain('stands firm');
    });
  });

  describe('moveArmy', () => {
    const battlefield: Battlefield = {
      dimensions: { width: 100, height: 100 },
    } as any;

    it('should update position if within bounds', () => {
      const army = { position: { x: 10, y: 10 } } as any;
      const result = moveArmy(army, 20, 30, battlefield);
      expect(result.position).toEqual({ x: 20, y: 30 });
    });

    it('should not update position if out of bounds', () => {
      const army = { position: { x: 10, y: 10 } } as any;
      const result = moveArmy(army, 150, 10, battlefield);
      expect(result.position).toEqual({ x: 10, y: 10 });
    });
  });

  describe('isBattleEnded', () => {
    it('should identify victory for a single remaining faction', () => {
      const armies: Army[] = [
        { faction: 'A', status: 'active', units: [{ size: 10 }] } as any,
        { faction: 'B', status: 'destroyed', units: [{ size: 0 }] } as any,
      ];
      const result = isBattleEnded(armies);
      expect(result.ended).toBe(true);
      expect(result.victor).toBe('A');
    });

    it('should identify a draw if no active units remain', () => {
      const armies: Army[] = [
        { faction: 'A', status: 'destroyed', units: [{ size: 0 }] } as any,
        { faction: 'B', status: 'destroyed', units: [{ size: 0 }] } as any,
      ];
      const result = isBattleEnded(armies);
      expect(result.ended).toBe(true);
      expect(result.victor).toBe(null);
    });

    it('should return ended: false if multiple factions are active', () => {
      const armies: Army[] = [
        { faction: 'A', status: 'active', units: [{ size: 10 }] } as any,
        { faction: 'B', status: 'active', units: [{ size: 5 }] } as any,
      ];
      const result = isBattleEnded(armies);
      expect(result.ended).toBe(false);
    });
  });

  describe('executeTacticalManeuver', () => {
    it('should fail if commander level is too low', () => {
      const maneuver: TacticalManeuver = { name: 'Charge', requiredCommanderLevel: 5 } as any;
      const commander: ArmyCommander = { name: 'Novice', level: 2 } as any;
      const army = {} as any;

      const result = executeTacticalManeuver(maneuver, commander, army);

      expect(result.success).toBe(false);
      expect(result.description).toContain('is not experienced enough');
    });

    it('should succeed and return correct effect for known maneuver', () => {
      const maneuver: TacticalManeuver = { id: 'flank_1', name: 'Flank', requiredCommanderLevel: 1 } as any;
      const commander: ArmyCommander = { name: 'Veteran', level: 10 } as any;
      const army = {} as any;

      const result = executeTacticalManeuver(maneuver, commander, army);

      expect(result.success).toBe(true);
      expect(result.effect).toBe('Units gain advantage on next attack roll.');
    });

    it('should handle other known maneuvers', () => {
      const commander: ArmyCommander = { level: 10 } as any;

      expect(executeTacticalManeuver({ id: 'charge_1' } as any, commander, {} as any).effect).toBe('Cavalry units deal double damage on next attack.');
      expect(executeTacticalManeuver({ id: 'rally_1' } as any, commander, {} as any).effect).toBe('Nearby friendly units regain 2 morale points.');
      expect(executeTacticalManeuver({ id: 'unknown' } as any, commander, {} as any).effect).toBe('Tactical maneuver executed successfully.');
    });
  });

  describe('simulateCombatRound', () => {
    it('should process a combat round and record events', () => {
      (rollDice as any).mockReturnValue({ total: 20 }); // hits and damage

      const army1: Army = {
        id: 'army-1',
        faction: 'FactionA',
        status: 'active',
        units: [
          {
            size: 10,
            hitPoints: 10,
            morale: 10,
            attacks: [{ attackBonus: 5, damage: '1d6' }],
          },
        ],
        position: { x: 0, y: 0 },
      } as any;

      const army2: Army = {
        id: 'army-2',
        faction: 'FactionB',
        status: 'active',
        units: [{ size: 10, hitPoints: 10, morale: 10, attacks: [] }],
        position: { x: 10, y: 10 },
      } as any;

      const round = simulateCombatRound([army1, army2], { dimensions: { width: 100, height: 100 } } as any, 1);

      expect(round.roundNumber).toBe(1);
      expect(round.events.length).toBeGreaterThan(0);
      expect(round.armyStatus.length).toBe(2);
    });

    it('should skip destroyed or routing armies', () => {
      const army1: Army = {
        id: 'army-1',
        status: 'destroyed',
        units: [],
        position: { x: 0, y: 0 },
      } as any;

      const round = simulateCombatRound([army1], {} as any, 1);
      expect(round.events.length).toBe(0);
      expect(round.armyStatus[0].status).toBe('destroyed');
    });
  });

  describe('calculateCasualties', () => {
    it('should calculate losses correctly', () => {
      const initialArmy = { units: [{ size: 100 }] } as any;
      const currentArmy = { id: 'army-1', units: [{ size: 80, type: 'infantry' }] } as any;

      const report = calculateCasualties(currentArmy, initialArmy);

      expect(report.initialCount).toBe(100);
      expect(report.losses).toBe(20);
      expect(report.survivors).toBe(80);
    });
  });

  describe('resupplyArmy', () => {
    it('should add supplies to an army', () => {
      const army = { supplies: 10 } as any;
      const updated = resupplyArmy(army, 5);
      expect(updated.supplies).toBe(15);
    });

    it('should handle missing initial supplies', () => {
      const army = {} as any;
      const updated = resupplyArmy(army, 10);
      expect(updated.supplies).toBe(10);
    });
  });

  describe('calculateStrategicPoints', () => {
    it('should sum value of controlled zones', () => {
      const army = { id: 'army-1' } as any;
      const zones = [
        { controllingArmyId: 'army-1', strategicValue: 5 },
        { controllingArmyId: 'army-2', strategicValue: 10 },
        { controllingArmyId: 'army-1', strategicValue: 3 },
      ] as any;

      const points = calculateStrategicPoints(army, zones);
      expect(points).toBe(8);
    });
  });

  describe('createDefaultCombatResult', () => {
    it('should return a default object', () => {
      const result = createDefaultCombatResult();
      expect(result.victor).toBeNull();
      expect(result.survivingArmies).toEqual([]);
    });
  });
});
