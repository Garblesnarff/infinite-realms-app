/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';

import {
  parseDiceCommand,
  getDiceCommandSuggestions,
  mightBeDiceCommand
} from '../diceCommandParser';

describe('diceCommandParser', () => {
  describe('parseDiceCommand', () => {
    it('should return null for non-roll commands', () => {
      expect(parseDiceCommand('/help')).toBeNull();
      expect(parseDiceCommand('just text')).toBeNull();
      expect(parseDiceCommand('/r')).toBeNull(); // Requires space and content
    });

    it('should parse simple dice rolls', () => {
      const result = parseDiceCommand('/r 1d20');
      expect(result).toMatchObject({
        isValid: true,
        formula: '1d20',
        count: 1,
        dieType: 20,
        modifier: 0,
        advantage: false,
        disadvantage: false
      });
    });

    it('should parse dice rolls with modifiers', () => {
      const result = parseDiceCommand('/roll 2d6+3');
      expect(result).toMatchObject({
        isValid: true,
        formula: '2d6+3',
        count: 2,
        dieType: 6,
        modifier: 3
      });

      const resultMinus = parseDiceCommand('/r 1d8-1');
      expect(resultMinus).toMatchObject({
        isValid: true,
        formula: '1d8-1',
        count: 1,
        dieType: 8,
        modifier: -1
      });
    });

    it('should parse rolls with advantage', () => {
      const result = parseDiceCommand('/r 1d20+5 adv');
      expect(result).toMatchObject({
        isValid: true,
        formula: '1d20+5',
        advantage: true,
        disadvantage: false
      });

      const resultFull = parseDiceCommand('/roll 1d20 advantage');
      expect(resultFull).toMatchObject({
        advantage: true
      });
    });

    it('should parse rolls with disadvantage', () => {
      const result = parseDiceCommand('/r 1d20-2 dis');
      expect(result).toMatchObject({
        isValid: true,
        disadvantage: true,
        advantage: false
      });

      const resultFull = parseDiceCommand('/roll 1d20 disadvantage');
      expect(resultFull).toMatchObject({
        disadvantage: true
      });
    });

    it('should cancel out advantage and disadvantage (D&D 5e)', () => {
      // In D&D 5e, if you have both, they cancel each other out to a normal roll
      const result = parseDiceCommand('/r 1d20 adv dis');
      expect(result).toMatchObject({
        isValid: true,
        advantage: false,
        disadvantage: false
      });
    });

    it('should parse labels', () => {
      const result = parseDiceCommand('/r 1d20+2 "Initiative"');
      expect(result).toMatchObject({
        isValid: true,
        formula: '1d20+2',
        label: 'Initiative'
      });
    });

    it('should handle labels containing keywords correctly', () => {
      // This tests for label corruption if keywords are stripped too early
      const result = parseDiceCommand('/r 1d20 "Attack with advantage"');
      expect(result).toMatchObject({
        isValid: true,
        label: 'Attack with advantage',
        advantage: false // Keywords in labels shouldn't trigger the flags
      });
    });

    it('should support shorthand die notation', () => {
      // "/r d20" should be treated as "1d20"
      const result = parseDiceCommand('/r d20');
      expect(result).toMatchObject({
        isValid: true,
        count: 1,
        dieType: 20,
        formula: '1d20'
      });

      const resultMod = parseDiceCommand('/r d8+2');
      expect(resultMod).toMatchObject({
        count: 1,
        dieType: 8,
        modifier: 2
      });
    });

    it('should return error for invalid dice count', () => {
      const result = parseDiceCommand('/r 0d20');
      expect(result?.isValid).toBe(false);
      expect(result?.error).toContain('between 1 and 100');

      const resultTooMany = parseDiceCommand('/r 101d6');
      expect(resultTooMany?.isValid).toBe(false);
    });

    it('should return error for invalid die types', () => {
      const result = parseDiceCommand('/r 1d7');
      expect(result?.isValid).toBe(false);
      expect(result?.error).toContain('Invalid die type');
    });

    it('should return error for completely invalid formula', () => {
      const result = parseDiceCommand('/r invalid');
      expect(result?.isValid).toBe(false);
      expect(result?.error).toContain('Invalid dice formula');
    });

    it('should handle case-insensitivity', () => {
      const result = parseDiceCommand('/ROLL 1D20 ADV');
      expect(result).toMatchObject({
        isValid: true,
        formula: '1d20',
        advantage: true
      });
    });
  });

  describe('getDiceCommandSuggestions', () => {
    it('should return empty list if not starting with /r', () => {
      expect(getDiceCommandSuggestions('/h')).toEqual([]);
      expect(getDiceCommandSuggestions('roll')).toEqual([]);
    });

    it('should return base suggestions for /r or /roll', () => {
      const suggestions = getDiceCommandSuggestions('/r');
      expect(suggestions).toContain('/roll 1d20');
      expect(suggestions).toContain('/roll 1d4');

      const suggestionsFull = getDiceCommandSuggestions('/roll');
      expect(suggestionsFull).toContain('/roll 1d20');

      const suggestionsPart = getDiceCommandSuggestions('/rol');
      expect(suggestionsPart).toContain('/roll 1d20');
    });

    it('should return descriptive suggestions for exact /r or /roll command', () => {
      const suggestions = getDiceCommandSuggestions('/roll');
      expect(suggestions).toContain('/roll 1d20 "Initiative"');
      expect(suggestions).toContain('/roll 1d8+3 "Longsword damage"');
    });
  });

  describe('mightBeDiceCommand', () => {
    it('should return true for strings starting with /r or /roll', () => {
      expect(mightBeDiceCommand('/r')).toBe(true);
      expect(mightBeDiceCommand('/roll ')).toBe(true);
      expect(mightBeDiceCommand('  /r 1d20')).toBe(true);
    });

    it('should return false for other strings', () => {
      expect(mightBeDiceCommand('roll')).toBe(false);
      expect(mightBeDiceCommand('/help')).toBe(false);
      expect(mightBeDiceCommand('/')).toBe(false);
    });
  });
});
