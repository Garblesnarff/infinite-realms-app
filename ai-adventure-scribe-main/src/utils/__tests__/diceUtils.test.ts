 
import { describe, it, expect, vi } from 'vitest';

import {
  rollDice,
  rollAttack,
  rollDamage,
  calculateDamage,
  rollSavingThrow,
  rollAbilityCheck,
  rollInitiative,
  rollGroupInitiative,
  rerollInitiative,
  parseDiceString,
} from '../diceUtils';

describe('diceUtils', () => {
  describe('rollDice', () => {
    it('should return a basic roll within range', () => {
      const result = rollDice(6, 1, 0);
      expect(result.total).toBeGreaterThanOrEqual(1);
      expect(result.total).toBeLessThanOrEqual(6);
      expect(result.dieType).toBe(6);
      expect(result.count).toBe(1);
    });

    it('should add modifier correctly', () => {
      const result = rollDice(6, 1, 5);
      expect(result.total).toBeGreaterThanOrEqual(6);
      expect(result.total).toBeLessThanOrEqual(11);
      expect(result.modifier).toBe(5);
    });

    it('should handle multiple dice', () => {
      const result = rollDice(6, 2, 0);
      expect(result.total).toBeGreaterThanOrEqual(2);
      expect(result.total).toBeLessThanOrEqual(12);
      expect(result.count).toBe(2);
      expect(result.results.length).toBe(2);
    });

    it('should handle advantage on d20 rolls', () => {
      // Mock Math.random to return 0.05 (roll 2) and 0.95 (roll 20)
      const mockRandom = vi.spyOn(Math, 'random');
      mockRandom.mockReturnValueOnce(0.05).mockReturnValueOnce(0.95);

      const result = rollDice(20, 1, 0, { advantage: true });

      expect(result.advantage).toBe(true);
      expect(result.disadvantage).toBe(false);
      expect(result.results).toEqual([2, 20]);
      expect(result.keptResults).toEqual([20]);
      expect(result.total).toBe(20);
      expect(result.critical).toBe(true);

      mockRandom.mockRestore();
    });

    it('should handle disadvantage on d20 rolls', () => {
      const mockRandom = vi.spyOn(Math, 'random');
      mockRandom.mockReturnValueOnce(0.05).mockReturnValueOnce(0.95);

      const result = rollDice(20, 1, 0, { disadvantage: true });

      expect(result.advantage).toBe(false);
      expect(result.disadvantage).toBe(true);
      expect(result.results).toEqual([2, 20]);
      expect(result.keptResults).toEqual([2]);
      expect(result.total).toBe(2);
      expect(result.critical).toBe(false);

      mockRandom.mockRestore();
    });

    it('should cancel out advantage and disadvantage if both are present', () => {
      const mockRandom = vi.spyOn(Math, 'random');
      mockRandom.mockReturnValue(0.5); // roll 11

      const result = rollDice(20, 1, 0, { advantage: true, disadvantage: true });

      expect(result.advantage).toBe(false);
      expect(result.disadvantage).toBe(false);
      expect(result.results.length).toBe(1);
      expect(result.total).toBe(11);

      mockRandom.mockRestore();
    });

    it('should handle Halfling Lucky (reroll 1s)', () => {
      const mockRandom = vi.spyOn(Math, 'random');
      // First roll is 1 (0.01), second roll is 10 (0.49)
      mockRandom.mockReturnValueOnce(0.01).mockReturnValueOnce(0.49);

      const result = rollDice(20, 1, 0, { halflingLucky: true });

      expect(result.results).toEqual([10]);
      expect(result.total).toBe(10);

      mockRandom.mockRestore();
    });

    it('should handle Halfling Lucky on second roll of advantage', () => {
      const mockRandom = vi.spyOn(Math, 'random');
      // Roll 1: 15 (0.7). Roll 2: 1 (0.01). Reroll 2: 20 (0.95)
      mockRandom.mockReturnValueOnce(0.7).mockReturnValueOnce(0.01).mockReturnValueOnce(0.95);

      const result = rollDice(20, 1, 0, { advantage: true, halflingLucky: true });

      expect(result.results).toEqual([15, 20]);
      expect(result.keptResults).toEqual([20]);
      expect(result.total).toBe(20);

      mockRandom.mockRestore();
    });
  });

  describe('calculateDamage', () => {
    it('should return base damage when no modifiers apply', () => {
      expect(calculateDamage(10, 'slashing')).toBe(10);
    });

    it('should return 0 for immunities', () => {
      expect(calculateDamage(10, 'fire', [], ['fire'])).toBe(0);
    });

    it('should halve damage for resistance (floored)', () => {
      expect(calculateDamage(11, 'cold', ['cold'])).toBe(5);
    });

    it('should double damage for vulnerability', () => {
      expect(calculateDamage(10, 'necrotic', [], [], ['necrotic'])).toBe(20);
    });

    it('should apply both resistance and vulnerability (resistance first, then vulnerability)', () => {
      // 11 -> Resistance -> 5 -> Vulnerability -> 10
      expect(calculateDamage(11, 'radiant', ['radiant'], [], ['radiant'])).toBe(10);
    });
  });

  describe('rollDamage', () => {
    it('should parse and roll a simple dice string', () => {
      const rolls = rollDamage('1d8+3');
      expect(rolls.length).toBe(1);
      expect(rolls[0].dieType).toBe(8);
      expect(rolls[0].count).toBe(1);
      expect(rolls[0].modifier).toBe(3);
    });

    it('should double dice on critical hit', () => {
      const rolls = rollDamage('1d8+3', true);
      expect(rolls[0].count).toBe(2);
      expect(rolls[0].modifier).toBe(3);
    });

    it('should handle negative modifiers', () => {
      const rolls = rollDamage('1d8-2');
      expect(rolls[0].modifier).toBe(-2);
    });

    it('should handle multiple dice groups', () => {
      const rolls = rollDamage('1d8+1d4+2');
      // Ideally should return two rolls or one roll with correct sum logic
      // Based on current interface returning DiceRoll[], two rolls is better
      expect(rolls.length).toBe(2);
      expect(rolls[0].dieType).toBe(8);
      expect(rolls[1].dieType).toBe(4);
      expect(rolls[0].modifier + rolls[1].modifier).toBe(2);
    });

    it('should handle pure modifier strings', () => {
      const rolls = rollDamage('5');
      expect(rolls.length).toBe(1);
      expect(rolls[0].total).toBe(5);
      expect(rolls[0].dieType).toBe(0);
    });

    it('should handle negative dice counts (e.g., -d8)', () => {
      const rolls = rollDamage('-d8');
      expect(rolls[0].count).toBe(-1);
      expect(rolls[0].dieType).toBe(8);
    });
  });

  describe('parseDiceString', () => {
    it('should parse simple strings', () => {
      expect(parseDiceString('1d20+5')).toEqual({ count: 1, dieType: 20, modifier: 5 });
      expect(parseDiceString('2d6')).toEqual({ count: 2, dieType: 6, modifier: 0 });
    });

    it('should handle negative modifiers', () => {
      expect(parseDiceString('1d8-2')).toEqual({ count: 1, dieType: 8, modifier: -2 });
    });

    it('should handle multiple dice groups', () => {
      // If we have to return a single object, maybe it should be the first group or a combined one.
      // Current implementation returns { count, dieType, modifier }.
      // This function might be too limited for multiple groups, but let's see what we can do.
      const result = parseDiceString('1d8+1d4+2');
      expect(result.count).toBe(1);
      expect(result.dieType).toBe(8);
      expect(result.modifier).toBe(2);
      expect(result.diceGroups).toEqual([{ count: 1, dieType: 8 }, { count: 1, dieType: 4 }]);
    });

    it('should handle negative dice counts in parseDiceString', () => {
      expect(parseDiceString('-d20')).toEqual({ count: -1, dieType: 20, modifier: 0 });
    });
  });

  describe('Specific Roll Wrappers', () => {
    it('rollAttack should use d20', () => {
      const result = rollAttack(5);
      expect(result.dieType).toBe(20);
      expect(result.modifier).toBe(5);
    });

    it('rollSavingThrow should use d20', () => {
      const result = rollSavingThrow(2, 3); // mod 2, prof 3
      expect(result.dieType).toBe(20);
      expect(result.modifier).toBe(5);
    });

    it('rollAbilityCheck should use d20', () => {
      const result = rollAbilityCheck(1, 2); // mod 1, prof 2
      expect(result.dieType).toBe(20);
      expect(result.modifier).toBe(3);
    });

    it('rollInitiative should use d20', () => {
      const result = rollInitiative(3, 5); // dex 3, bonus 5
      expect(result.dieType).toBe(20);
      expect(result.modifier).toBe(8);
    });

    it('rollGroupInitiative should return results for all participants', () => {
      const participants = [
        { id: '1', dexModifier: 2 },
        { id: '2', dexModifier: 1, bonuses: 2 },
      ];
      const results = rollGroupInitiative(participants);
      expect(results.length).toBe(2);
      expect(results[0].participantId).toBe('1');
      expect(results[1].participantId).toBe('2');
    });

    it('rerollInitiative should respect minInitiative', () => {
      const mockRandom = vi.spyOn(Math, 'random');
      // First roll: 0.1 * 20 + 1 = 3. Second roll: 0.75 * 20 + 1 = 16.
      mockRandom.mockReturnValueOnce(0.1).mockReturnValueOnce(0.75);

      const result = rerollInitiative(0, 0, {}, 10);

      expect(result.total).toBe(16);
      expect(mockRandom).toHaveBeenCalledTimes(2);

      mockRandom.mockRestore();
    });
  });
});
