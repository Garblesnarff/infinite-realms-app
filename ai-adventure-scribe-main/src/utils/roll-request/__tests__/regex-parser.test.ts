import { describe, it, expect } from 'vitest';

import { parseRegexRollRequests, normalizeFormula } from '../regex-parser';

describe('regex-parser', () => {
  describe('parseRegexRollRequests', () => {
    it('should detect DC in simple skill pattern trailing window', () => {
      // Targets lines 310-313 in regex-parser.ts
      // Pattern: ROLL_SKILL_SIMPLE_PATTERN = /roll <skill> (DC 12)/gi
      // But we want to test the case where match[2] (explicit DC) is missing,
      // but DC_CONTEXT_PATTERN finds it in the tail.

      const message = "Please roll Investigation target dc 15";
      const result = parseRegexRollRequests(message);

      const investigation = result.find(r => r.purpose === 'Investigation check');
      expect(investigation).toBeDefined();
      expect(investigation?.dc).toBe(15);
    });

    it('should detect spell attack for unknown spell with length > 2', () => {
      // Targets lines 169-173
      const message = "i cast spectral scythe at the goblin";
      const result = parseRegexRollRequests(message);
      const roll = result.find(r => r.purpose === 'Spectral Scythe spell attack');
      expect(roll).toBeDefined();
    });

    it('should detect DC in ROLL_SKILL_CHECK_PATTERN context tail', () => {
      // Targets lines 266-282
      const message = "Please roll a stealth check difficulty class 20";
      const result = parseRegexRollRequests(message);
      const stealth = result.find(r => r.purpose === 'Stealth check');
      expect(stealth).toBeDefined();
      expect(stealth?.dc).toBe(20);
    });

    it('should handle skill checks with article "a"', () => {
      const message = "Make a Athletics check";
      const result = parseRegexRollRequests(message);
      expect(result.some(r => r.purpose === 'Athletics check')).toBe(true);
    });
  });

  describe('normalizeFormula', () => {
    it('should return 1d20 for non-standard formulas that dont match standard pattern', () => {
      // Targets lines 419-420 in regex-parser.ts
      // if (!normalized.match(/^\d*d\d+([+-]\d+)*$/)) { return '1d20'; }

      expect(normalizeFormula('2d6+5+invalid')).toBe('1d20');
      expect(normalizeFormula('1d20++modifier')).toBe('1d20'); // double plus then non-digit
    });

    it('should handle formula with only a sign and number', () => {
      expect(normalizeFormula('+10')).toBe('1d20+10');
      expect(normalizeFormula('-5')).toBe('1d20-5');
    });

    it('should handle ability shorthand', () => {
      expect(normalizeFormula('str')).toBe('1d20+modifier');
    });
  });
});
