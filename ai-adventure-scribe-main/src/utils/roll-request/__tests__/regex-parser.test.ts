/* eslint-disable max-lines */
import { describe, it, expect } from 'vitest';

import { normalizeFormula } from '../formula-utils';
import { parseRegexRollRequests } from '../regex-parser';

describe('regex-parser', () => {
  describe('parseRegexRollRequests', () => {
    // Attack Patterns
    it('should detect attack rolls with weapon and AC', () => {
      const message = "Please make an attack roll with your longsword against the orc (AC: 15)";
      const result = parseRegexRollRequests(message);
      const attack = result.find(r => r.type === 'attack');
      expect(attack).toBeDefined();
      expect(attack?.purpose).toMatch(/Longsword/i);
      expect(attack?.ac).toBe(15);
    });

    it('should detect attack rolls with "roll to hit"', () => {
      const message = "Roll to hit with your shortbow, the target AC is 12";
      const result = parseRegexRollRequests(message);
      const attack = result.find(r => r.type === 'attack');
      expect(attack).toBeDefined();
      expect(attack?.purpose).toMatch(/Shortbow/i);
      expect(attack?.ac).toBe(12);
    });

    it('should handle attack roll without weapon hint', () => {
      const message = "Please make an attack roll against the target.";
      const result = parseRegexRollRequests(message);
      const attack = result.find(r => r.type === 'attack');
      expect(attack).toBeDefined();
      expect(attack?.purpose).toBe('Attack roll');
    });

    // Spell Attack Patterns
    it('should detect common spell attacks', () => {
      const message = "I cast Fire Bolt at the troll.";
      const result = parseRegexRollRequests(message);
      const attack = result.find(r => r.type === 'attack');
      expect(attack).toBeDefined();
      expect(attack?.purpose).toBe('Fire Bolt attack');
      expect(attack?.formula).toBe('1d20+spell_attack_bonus');
    });

    it('should detect unknown spell attacks', () => {
      const message = "Use your Eldritch Blast spell attack roll.";
      const result = parseRegexRollRequests(message);
      const attack = result.find(r => r.type === 'attack');
      expect(attack).toBeDefined();
      expect(attack?.purpose).toBe('Eldritch Blast attack');
    });

    it('should detect spell attack for unknown spell with length > 2', () => {
      const message = "i cast spectral scythe at the goblin";
      const result = parseRegexRollRequests(message);
      const roll = result.find(r => r.purpose === 'Spectral Scythe spell attack');
      expect(roll).toBeDefined();
    });

    // Initiative Patterns
    it('should detect initiative rolls', () => {
      const message = "Roll initiative!";
      const result = parseRegexRollRequests(message);
      const initiative = result.find(r => r.type === 'initiative');
      expect(initiative).toBeDefined();
      expect(initiative?.formula).toBe('1d20+dex');
    });

    it('should detect initiative rolls with explicit formula', () => {
      const message = "Roll initiative (1d20+5)";
      const result = parseRegexRollRequests(message);
      const initiative = result.find(r => r.type === 'initiative');
      expect(initiative).toBeDefined();
      expect(initiative?.formula).toBe('1d20+5');
    });

    // Explicit Check Patterns
    it('should detect explicit ability checks with DC', () => {
      const message = "Make a Strength check (1d20+STR, DC 12)";
      const result = parseRegexRollRequests(message);
      const check = result.find(r => r.type === 'check');
      expect(check).toBeDefined();
      expect(check?.purpose).toBe('Strength check');
      expect(check?.dc).toBe(12);
    });

    it('should detect explicit saving throws', () => {
      const message = "Make a dexterity save (1d20+DEX, DC 15)";
      const result = parseRegexRollRequests(message);
      const save = result.find(r => r.type === 'save');
      expect(save).toBeDefined();
      expect(save?.purpose).toMatch(/Dexterity/i);
      expect(save?.dc).toBe(15);
    });

    // Skill Check Variations
    it('should detect "Roll for <skill>" with DC', () => {
      const message = "Please roll for Perception (DC 14)";
      const result = parseRegexRollRequests(message);
      const check = result.find(r => r.purpose === 'Perception check');
      expect(check).toBeDefined();
      expect(check?.dc).toBe(14);
    });

    it('should detect "make a <skill> check"', () => {
      const message = "Make a Stealth check";
      const result = parseRegexRollRequests(message);
      const check = result.find(r => r.purpose === 'Stealth check');
      expect(check).toBeDefined();
    });

    it('should detect "roll an <skill> check" with DC', () => {
      const message = "Roll an Investigation check (DC 15)";
      const result = parseRegexRollRequests(message);
      const check = result.find(r => r.purpose === 'Investigation check');
      expect(check).toBeDefined();
      expect(check?.dc).toBe(15);
    });

    it('should detect DC in ROLL_SKILL_CHECK_PATTERN context tail', () => {
      const message = "Please roll a stealth check difficulty class 20";
      const result = parseRegexRollRequests(message);
      const stealth = result.find(r => r.purpose === 'Stealth check');
      expect(stealth).toBeDefined();
      expect(stealth?.dc).toBe(20);
    });

    it('should detect "Give me an <skill> check"', () => {
      const message = "Give me an Insight check";
      const result = parseRegexRollRequests(message);
      const check = result.find(r => r.purpose === 'Insight check');
      expect(check).toBeDefined();
    });

    it('should detect "Roll <skill>" with DC', () => {
      const message = "Roll Athletics (DC 12)";
      const result = parseRegexRollRequests(message);
      const check = result.find(r => r.purpose === 'Athletics check');
      expect(check).toBeDefined();
      expect(check?.dc).toBe(12);
    });

    it('should detect DC in simple skill pattern trailing window', () => {
      const message = "Please roll Investigation target dc 15";
      const result = parseRegexRollRequests(message);
      const investigation = result.find(r => r.purpose === 'Investigation check');
      expect(investigation).toBeDefined();
      expect(investigation?.dc).toBe(15);
    });

    it('should handle skill checks with multi-word skill names', () => {
      const message = "Make a Sleight of Hand check";
      const result = parseRegexRollRequests(message);
      expect(result.some(r => r.purpose === 'Sleight Of Hand check')).toBe(true);
    });

    it('should handle skill checks with article "a"', () => {
      const message = "Make a Athletics check";
      const result = parseRegexRollRequests(message);
      expect(result.some(r => r.purpose === 'Athletics check')).toBe(true);
    });

    // Damage Patterns
    it('should detect damage rolls with explicit formula', () => {
      const message = "Roll damage (2d6+3)";
      const result = parseRegexRollRequests(message);
      const damage = result.find(r => r.type === 'damage');
      expect(damage).toBeDefined();
      expect(damage?.formula).toBe('2d6+3');
    });

    it('should detect critical damage', () => {
      const message = "Critical hit! Roll critical damage (4d6+3)";
      const result = parseRegexRollRequests(message);
      const damage = result.find(r => r.type === 'damage');
      expect(damage).toBeDefined();
      expect(damage?.purpose).toBe('Critical damage roll');
    });

    it('should detect damage roll without explicit dice', () => {
      const message = "That hits! Roll damage for your attack.";
      const result = parseRegexRollRequests(message);
      const damage = result.find(r => r.type === 'damage');
      expect(damage).toBeDefined();
    });

    // Generic Roll Patterns
    it('should detect generic roll requests', () => {
      const message = "Roll 1d100 for wild magic";
      const result = parseRegexRollRequests(message);
      const roll = result.find(r => r.formula === '1d100');
      expect(roll).toBeDefined();
      expect(roll?.purpose).toMatch(/Wild/i);
    });

    it('should detect generic roll with DC and AC', () => {
      const message = "Roll 1d20 for something (DC 15, AC 18)";
      const result = parseRegexRollRequests(message);
      const roll = result[0];
      expect(roll.dc).toBe(15);
      expect(roll.ac).toBe(18);
    });

    // Bug detection: Markdown damage
    it('should detect markdown-wrapped damage requests', () => {
      const message = "**Roll 2d6 for damage**";
      const result = parseRegexRollRequests(message);
      const damage = result.find(r => r.type === 'damage');
      // This is expected to FAIL until we fix the bug
      expect(damage).toBeDefined();
    });
  });

  describe('normalizeFormula', () => {
    it('should return 1d20 for non-standard formulas that dont match standard pattern', () => {
      expect(normalizeFormula('2d6+5+invalid')).toBe('1d20');
      expect(normalizeFormula('1d20++modifier')).toBe('1d20');
    });

    it('should handle formula with only a sign and number', () => {
      expect(normalizeFormula('+10')).toBe('1d20+10');
      expect(normalizeFormula('-5')).toBe('1d20-5');
      expect(normalizeFormula('5')).toBe('1d20+5');
    });

    it('should handle ability shorthands', () => {
      expect(normalizeFormula('str')).toBe('1d20+modifier');
      expect(normalizeFormula('dexterity')).toBe('1d20+modifier');
    });

    it('should handle existing dice formulas', () => {
      expect(normalizeFormula('2d6+4')).toBe('2d6+4');
      expect(normalizeFormula(' d20 + 5 ')).toBe('1d20+5');
    });

    it('should handle symbolic ability formulas', () => {
      expect(normalizeFormula('1d20+cha')).toBe('1d20+cha');
      expect(normalizeFormula('1d20-wis')).toBe('1d20-wis');
    });

    it('should return 1d20 for empty or invalid strings', () => {
        expect(normalizeFormula('')).toBe('1d20');
        expect(normalizeFormula('invalid')).toBe('1d20');
    });
  });
});
