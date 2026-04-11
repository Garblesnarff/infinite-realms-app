/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  rollDie,
  roll4d6DropLowest,
  roll4d6DropLowestDetailed,
  generateAbilityScores,
  generateAbilityScoresDetailed,
  rerollSingleScore,
  rerollSingleScoreDetailed,
  d20,
} from './diceRolls';

describe('diceRolls utilities', () => {
  let mathRandomSpy: any;

  beforeEach(() => {
    mathRandomSpy = vi.spyOn(Math, 'random');
  });

  afterEach(() => {
    mathRandomSpy.mockRestore();
  });

  describe('rollDie', () => {
    it('should return a number between 1 and the number of sides (inclusive)', () => {
      const sides = 6;
      const result = rollDie(sides);
      expect(result).toBeGreaterThanOrEqual(1);
      expect(result).toBeLessThanOrEqual(sides);
    });

    it('should return 1 when rolling a 1-sided die', () => {
      expect(rollDie(1)).toBe(1);
    });

    it('should return 1 for 0 or negative sides', () => {
      expect(rollDie(0)).toBe(1);
      expect(rollDie(-1)).toBe(1);
    });

    it('should produce a distribution of rolls (stochastic test)', () => {
      mathRandomSpy.mockRestore(); // Use real random for distribution test
      const sides = 6;
      const rolls = Array.from({ length: 1000 }, () => rollDie(sides));
      const counts = new Array(sides + 1).fill(0);
      rolls.forEach((roll) => {
        counts[roll]++;
      });
      for (let i = 1; i <= sides; i++) {
        expect(counts[i]).toBeGreaterThan(0);
      }
      expect(counts[0]).toBe(0);
    });
  });

  describe('roll4d6DropLowest', () => {
    it('should return a sum between 3 and 18', () => {
      mathRandomSpy.mockRestore();
      const result = roll4d6DropLowest();
      expect(result).toBeGreaterThanOrEqual(3);
      expect(result).toBeLessThanOrEqual(18);
    });

    it('should correctly drop the lowest roll', () => {
      mathRandomSpy
        .mockReturnValueOnce(0 / 6) // 1
        .mockReturnValueOnce(1 / 6) // 2
        .mockReturnValueOnce(2 / 6) // 3
        .mockReturnValueOnce(3 / 6); // 4

      // 2+3+4 = 9
      expect(roll4d6DropLowest()).toBe(9);
    });
  });

  describe('roll4d6DropLowestDetailed', () => {
    it('should return detailed roll information', () => {
      mathRandomSpy
        .mockReturnValueOnce(0.99) // 6
        .mockReturnValueOnce(0.01) // 1
        .mockReturnValueOnce(0.5)  // 4
        .mockReturnValueOnce(0.8); // 5

      const result = roll4d6DropLowestDetailed();

      expect(result.rolls).toEqual([6, 1, 4, 5]);
      expect(result.dropped).toBe(1);
      expect(result.kept).toEqual([6, 5, 4]);
      expect(result.total).toBe(15);
    });
  });

  describe('generateAbilityScores', () => {
    it('should return an array of 6 scores', () => {
      const scores = generateAbilityScores();
      expect(scores).toHaveLength(6);
      scores.forEach(s => {
        expect(s).toBeGreaterThanOrEqual(3);
        expect(s).toBeLessThanOrEqual(18);
      });
    });
  });

  describe('generateAbilityScoresDetailed', () => {
    it('should return 6 detailed scores and a timestamp', () => {
      const result = generateAbilityScoresDetailed();
      expect(result.scores).toHaveLength(6);
      expect(result.details).toHaveLength(6);
      expect(result.timestamp).toBeInstanceOf(Date);
      expect(result.scores[0]).toBe(result.details[0].total);
    });
  });

  describe('rerollSingleScore', () => {
    it('should reroll only the specified index', () => {
      const initialScores = [10, 10, 10, 10, 10, 10];
      mathRandomSpy.mockReturnValue(0.99); // Rolls 6s -> total 18

      const newScores = rerollSingleScore(initialScores, 2);

      expect(newScores[2]).toBe(18);
      expect(newScores[0]).toBe(10);
      expect(newScores[1]).toBe(10);
      expect(newScores[3]).toBe(10);
      expect(newScores[4]).toBe(10);
      expect(newScores[5]).toBe(10);
    });

    it('should throw error for invalid index', () => {
      expect(() => rerollSingleScore([10, 10, 10, 10, 10, 10], -1)).toThrow();
      expect(() => rerollSingleScore([10, 10, 10, 10, 10, 10], 6)).toThrow();
    });
  });

  describe('rerollSingleScoreDetailed', () => {
    it('should update specific detail index', () => {
      const initialResult = generateAbilityScoresDetailed();
      const oldDetail = { ...initialResult.details[3] };

      mathRandomSpy.mockReturnValue(0.01); // Rolls 1s -> total 3
      const newResult = rerollSingleScoreDetailed(initialResult.scores, initialResult.details, 3);

      expect(newResult.scores[3]).toBe(3);
      expect(newResult.details[3].total).toBe(3);
      expect(newResult.details[3]).not.toEqual(oldDetail);
      expect(newResult.details[0]).toEqual(initialResult.details[0]);
    });

    it('should throw for invalid index', () => {
        const res = generateAbilityScoresDetailed();
        expect(() => rerollSingleScoreDetailed(res.scores, res.details, 7)).toThrow();
    });
  });

  describe('d20', () => {
    it('should return value between 1 and 20', () => {
      mathRandomSpy.mockReturnValue(0);
      expect(d20()).toBe(1);

      mathRandomSpy.mockReturnValue(0.999);
      expect(d20()).toBe(20);
    });
  });
});
