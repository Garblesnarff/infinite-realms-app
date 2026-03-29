/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { parseRollRequests, normalizeFormula } from '../parse';

describe('parseRollRequests', () => {
  describe('Structured ROLL_REQUESTS_V1', () => {
    it('should parse a valid structured roll request', () => {
      const message = `
Some narrative text.
\`\`\`ROLL_REQUESTS_V1
{
  "rolls": [
    {
      "type": "attack",
      "formula": "1d20+5",
      "purpose": "Longsword attack",
      "ac": 15
    }
  ]
}
\`\`\`
`;
      const result = parseRollRequests(message);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        type: 'attack',
        formula: '1d20+5',
        purpose: 'Longsword attack',
        ac: 15,
        confidence: 1.0,
      });
    });

    it('should handle "purity" as a fallback for "purpose"', () => {
      const message = `
\`\`\`ROLL_REQUESTS_V1
{
  "rolls": [
    {
      "type": "check",
      "formula": "1d20+2",
      "purity": "Insight check"
    }
  ]
}
\`\`\`
`;
      const result = parseRollRequests(message);
      expect(result[0].purpose).toBe('Insight check');
    });

    it('should handle multiple rolls in one block', () => {
      const message = `
\`\`\`ROLL_REQUESTS_V1
{
  "rolls": [
    { "type": "attack", "formula": "1d20+5", "purpose": "Attack" },
    { "type": "damage", "formula": "1d8+3", "purpose": "Damage" }
  ]
}
\`\`\`
`;
      const result = parseRollRequests(message);
      expect(result).toHaveLength(2);
      expect(result[0].purpose).toBe('Attack');
      expect(result[1].purpose).toBe('Damage');
    });

    it('should ignore invalid JSON blocks', () => {
      const message = `
\`\`\`ROLL_REQUESTS_V1
{ invalid json
\`\`\`
make an attack roll
`;
      // Should fall back to regex
      const result = parseRollRequests(message);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('attack');
    });
  });

  describe('Regex Pattern Matching', () => {
    describe('Attack Patterns', () => {
      it('should detect simple attack rolls', () => {
        expect(parseRollRequests('Please make an attack roll')[0].type).toBe('attack');
        expect(parseRollRequests('roll to hit')[0].type).toBe('attack');
      });

      it('should extract weapon name from context', () => {
        const result = parseRollRequests('Make an attack roll with your Silvered Longsword');
        expect(result[0].purpose).toBe('Silvered Longsword attack');
      });

      it('should extract AC from context', () => {
        const result = parseRollRequests('Roll to attack against AC 16');
        expect(result[0].ac).toBe(16);
      });
    });

    describe('Spell Attack Patterns', () => {
      it('should detect known attack spells', () => {
        const result = parseRollRequests('I cast Fire Bolt at the goblin');
        expect(result[0].purpose).toBe('Fire Bolt attack');
        expect(result[0].formula).toBe('1d20+spell_attack_bonus');
      });

      it('should detect generic spell attacks', () => {
        const result = parseRollRequests('Make a ranged spell attack');
        expect(result[0].purpose).toBe('Spell attack');
      });

      it('should detect "cast <spell>" at end of sentence', () => {
        const result = parseRollRequests('The wizard will cast Shocking Grasp');
        expect(result[0].purpose).toBe('Shocking Grasp attack');
      });
    });

    describe('Initiative Patterns', () => {
      it('should detect simple initiative requests', () => {
        const result = parseRollRequests('Roll initiative!');
        expect(result[0].type).toBe('initiative');
        expect(result[0].formula).toBe('1d20+dex');
      });

      it('should detect initiative with explicit formula', () => {
        const result = parseRollRequests('Roll initiative (1d20+2)');
        expect(result[0].formula).toBe('1d20+2');
      });
    });

    describe('Check and Save Patterns', () => {
      it('should detect explicit checks with dice', () => {
        const result = parseRollRequests('Make a Wisdom save (1d20+3)');
        expect(result[0]).toMatchObject({
          type: 'save',
          formula: '1d20+3',
          purpose: 'Wisdom save'
        });
      });

      it('should detect skill checks without explicit dice', () => {
        expect(parseRollRequests('Roll for Stealth (DC 12)')[0].purpose).toBe('Stealth check');
        expect(parseRollRequests('Make a Perception check')[0].purpose).toBe('Perception check');
        expect(parseRollRequests('Give me an Investigation check')[0].purpose).toBe('Investigation check');
        expect(parseRollRequests('Roll Athletics (DC 15)')[0].purpose).toBe('Athletics check');
      });

      it('should find DC in nearby context', () => {
        // Fallback test for DC in context
        const result = parseRollRequests('Roll for Perception (DC 15)');
        expect(result[0].dc).toBe(15);
      });
    });

    describe('Damage Patterns', () => {
      it('should detect damage rolls with formulas', () => {
        const result = parseRollRequests('Roll 2d6+4 for damage');
        expect(result[0].type).toBe('damage');
        expect(result[0].formula).toBe('2d6+4');
      });

      it('should detect critical damage', () => {
        const result = parseRollRequests('That is a critical hit! Roll critical damage (2d8)');
        expect(result[0].purpose).toBe('Critical damage roll');
        expect(result[0].formula).toBe('2d8');
      });
    });

    describe('Generic and Edge Cases', () => {
      it('should handle generic roll requests', () => {
        const result = parseRollRequests('Roll 1d100 for WildMagic');
        expect(result[0].purpose).toBe('WildMagic');
        expect(result[0].formula).toBe('1d100');
      });

      it('should deduplicate requests with same purpose', () => {
        const result = parseRollRequests('Roll for Stealth. Make a Stealth check.');
        expect(result).toHaveLength(1);
      });

      it('should normalize message (remove markdown)', () => {
        const result = parseRollRequests('Make a **Perception** check');
        expect(result[0].purpose).toBe('Perception check');
      });
    });
  });
});

describe('normalizeFormula', () => {
  it('should normalize whitespace and case', () => {
    expect(normalizeFormula(' 1D20 + 5 ')).toBe('1d20+5');
  });

  it('should handle numeric modifiers', () => {
    expect(normalizeFormula('+5')).toBe('1d20+5');
    expect(normalizeFormula('-2')).toBe('1d20-2');
    expect(normalizeFormula('3')).toBe('1d20+3');
  });

  it('should handle symbolic modifiers', () => {
    expect(normalizeFormula('1d20 + dex')).toBe('1d20+dex');
    expect(normalizeFormula('Modifier')).toBe('1d20');
    expect(normalizeFormula('wis')).toBe('1d20+modifier');
  });

  it('should preserve symbolic ability formulas', () => {
    expect(normalizeFormula('1d20+cha')).toBe('1d20+cha');
  });

  it('should fall back to 1d20 for unknown strings', () => {
    expect(normalizeFormula('not a roll')).toBe('1d20');
  });

  it('should clean up double signs', () => {
    expect(normalizeFormula('1d20++2')).toBe('1d20+2');
    expect(normalizeFormula('1d20--1')).toBe('1d20-1');
  });
});
