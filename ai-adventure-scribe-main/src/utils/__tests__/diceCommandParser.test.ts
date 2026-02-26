import { describe, it, expect } from 'vitest';

import {
  parseDiceCommand,
  getDiceCommandSuggestions,
  mightBeDiceCommand,
} from '../diceCommandParser';

describe('diceCommandParser', () => {
  describe('parseDiceCommand', () => {
    it('should return null for non-dice commands', () => {
      expect(parseDiceCommand('hello')).toBeNull();
      expect(parseDiceCommand('!roll 1d20')).toBeNull();
      expect(parseDiceCommand('/notaroll 1d20')).toBeNull();
    });

    it('should parse basic dice rolls', () => {
      const result = parseDiceCommand('/roll 1d20');
      expect(result).toMatchObject({
        isValid: true,
        count: 1,
        dieType: 20,
        modifier: 0,
        formula: '1d20',
        advantage: false,
        disadvantage: false,
      });

      const resultShort = parseDiceCommand('/r 2d6+3');
      expect(resultShort).toMatchObject({
        isValid: true,
        count: 2,
        dieType: 6,
        modifier: 3,
        formula: '2d6+3',
      });

      const resultNegative = parseDiceCommand('/roll 1d100-5');
      expect(resultNegative).toMatchObject({
        isValid: true,
        count: 1,
        dieType: 100,
        modifier: -5,
        formula: '1d100-5',
      });
    });

    it('should parse advantage and disadvantage', () => {
      expect(parseDiceCommand('/roll 1d20 adv')).toMatchObject({
        advantage: true,
        disadvantage: false,
      });

      expect(parseDiceCommand('/r 1d20 advantage')).toMatchObject({
        advantage: true,
        disadvantage: false,
      });

      expect(parseDiceCommand('/roll 1d20 dis')).toMatchObject({
        advantage: false,
        disadvantage: true,
      });

      expect(parseDiceCommand('/r 1d20 disadvantage')).toMatchObject({
        advantage: false,
        disadvantage: true,
      });
    });

    it('should handle precedence when both advantage and disadvantage are provided', () => {
      // Advantage takes precedence per code logic
      const result = parseDiceCommand('/roll 1d20 adv dis');
      expect(result).toMatchObject({
        advantage: true,
        disadvantage: false,
      });
    });

    it('should parse labels', () => {
      const result = parseDiceCommand('/roll 1d20 "Attack Roll"');
      expect(result).toMatchObject({
        isValid: true,
        formula: '1d20',
        label: 'Attack Roll',
      });

      const resultWithAdv = parseDiceCommand('/r 2d6+2 "Healing" adv');
      expect(resultWithAdv).toMatchObject({
        isValid: true,
        formula: '2d6+2',
        label: 'Healing',
        advantage: true,
      });
    });

    it('should handle case insensitivity and extra spaces', () => {
      expect(parseDiceCommand('  /ROLL   1d20  ')).toMatchObject({
        isValid: true,
        count: 1,
        dieType: 20,
      });

      expect(parseDiceCommand('/r 1d20 ADV')).toMatchObject({
        advantage: true,
      });
    });

    it('should return invalid for incorrect formulas', () => {
      const result = parseDiceCommand('/roll 1d21');
      expect(result?.isValid).toBe(false);
      expect(result?.error).toContain('Invalid die type');

      const resultCount = parseDiceCommand('/roll 101d6');
      expect(resultCount?.isValid).toBe(false);
      expect(resultCount?.error).toContain('Number of dice must be between 1 and 100');

      const resultFormat = parseDiceCommand('/roll d20');
      expect(resultFormat?.isValid).toBe(false);
      expect(resultFormat?.error).toContain('Invalid dice formula');

      const resultSpaces = parseDiceCommand('/roll 1d20 + 5');
      expect(resultSpaces?.isValid).toBe(false);
      expect(resultSpaces?.error).toContain('Invalid dice formula');
    });
  });

  describe('getDiceCommandSuggestions', () => {
    it('should return empty array if input does not start with /r', () => {
      expect(getDiceCommandSuggestions('hello')).toEqual([]);
    });

    it('should return basic suggestions for partial commands', () => {
      const suggestions = getDiceCommandSuggestions('/rol');
      expect(suggestions).toContain('/roll 1d20');
      expect(suggestions).toContain('/roll 2d6');
    });

    it('should return common D&D rolls for complete command prefix', () => {
      const suggestions = getDiceCommandSuggestions('/r');
      expect(suggestions).toContain('/roll 1d20 "Initiative"');
      expect(suggestions).toContain('/roll 1d20 adv "Attack with advantage"');
    });

    it('should be case insensitive', () => {
      expect(getDiceCommandSuggestions('/R')).toContain('/roll 1d20');
    });
  });

  describe('mightBeDiceCommand', () => {
    it('should return true for strings starting with /r or /roll', () => {
      expect(mightBeDiceCommand('/r')).toBe(true);
      expect(mightBeDiceCommand('/roll')).toBe(true);
      expect(mightBeDiceCommand('/r 1d20')).toBe(true);
      expect(mightBeDiceCommand(' /roll ')).toBe(true);
    });

    it('should return false for other strings', () => {
      expect(mightBeDiceCommand('hello')).toBe(false);
      expect(mightBeDiceCommand('roll 1d20')).toBe(false);
      expect(mightBeDiceCommand('/notaroll')).toBe(false);
    });
  });
});
