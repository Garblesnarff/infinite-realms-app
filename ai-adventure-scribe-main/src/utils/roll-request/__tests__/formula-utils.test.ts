import { describe, it, expect } from 'vitest';

import { normalizeFormula, resolveFormulaForCharacter } from '../formula-utils';

describe('normalizeFormula', () => {
  it('should return 1d20 for empty or null input', () => {
    expect(normalizeFormula('')).toBe('1d20');
    // @ts-ignore - testing runtime behavior
    expect(normalizeFormula(null)).toBe('1d20');
  });

  it('should normalize whitespace and case', () => {
    expect(normalizeFormula(' 1D20 + 5 ')).toBe('1d20+5');
  });

  it('should handle shorthand "d20"', () => {
    expect(normalizeFormula('d20')).toBe('1d20');
    expect(normalizeFormula('d8')).toBe('1d8');
  });

  it('should handle numeric modifiers by prepending 1d20', () => {
    expect(normalizeFormula('+5')).toBe('1d20+5');
    expect(normalizeFormula('-2')).toBe('1d20-2');
    expect(normalizeFormula('3')).toBe('1d20+3');
  });

  it('should handle symbolic ability names', () => {
    expect(normalizeFormula('dex')).toBe('1d20+modifier');
    expect(normalizeFormula('STR')).toBe('1d20+modifier');
    expect(normalizeFormula('Wisdom')).toBe('1d20+modifier');
  });

  it('should preserve symbolic ability formulas', () => {
    expect(normalizeFormula('1d20+cha')).toBe('1d20+cha');
    expect(normalizeFormula('1d20-int')).toBe('1d20-int');
  });

  it('should clean up double signs and trailing signs', () => {
    expect(normalizeFormula('1d20++2')).toBe('1d20+2');
    expect(normalizeFormula('1d20--1')).toBe('1d20-1');
    expect(normalizeFormula('1d20+')).toBe('1d20');
    expect(normalizeFormula('1d20-')).toBe('1d20');
  });

  it('should fall back to 1d20 for completely invalid strings', () => {
    expect(normalizeFormula('invalid')).toBe('1d20');
    expect(normalizeFormula('!!!')).toBe('1d20');
  });

  it('should be idempotent', () => {
    const inputs = ['1d20+5', 'dex', '1d20+cha', '+3', 'd20'];

    inputs.forEach((input) => {
      const firstPass = normalizeFormula(input);
      const secondPass = normalizeFormula(firstPass);
      expect(secondPass).toBe(firstPass, `Failed idempotency for input: ${input}`);
    });
  });

  it('identifies the specific idempotency failure for "modifier"', () => {
    const result1 = normalizeFormula('dex');
    expect(result1).toBe('1d20+modifier');

    const result2 = normalizeFormula(result1);
    // This previously failed in the code:
    // normalizeFormula('1d20+modifier')
    // -> .replace(/modifier/g, '') -> '1d20+'
    // -> .replace(/\+$/, '') -> '1d20'
    expect(result2).toBe('1d20+modifier');
  });

  it('should handle complex symbolic formulas', () => {
    expect(normalizeFormula('2d6+str+dex')).toBe('1d20'); // Current logic doesn't support multiple symbolic mods, should fallback
  });

  it('covers the symbolic ability formula branch', () => {
    expect(normalizeFormula('1d8+str')).toBe('1d8+str');
    expect(normalizeFormula('2d10-dex')).toBe('2d10-dex');
  });
});

describe('resolveFormulaForCharacter', () => {
  const character = {
    abilityScores: {
      dexterity: { score: 16, modifier: 3 },
      wisdom: { score: 12, modifier: 1 },
    },
  };

  it('resolves symbolic ability tokens with the loaded character modifier', () => {
    expect(resolveFormulaForCharacter('1d20+dex', character, 'Initiative', 'initiative')).toBe(
      '1d20+3',
    );
    expect(resolveFormulaForCharacter('1d20+wisdom', character, 'Wisdom save', 'save')).toBe(
      '1d20+1',
    );
  });

  it('returns null for symbolic formulas that the sheet cannot resolve', () => {
    expect(resolveFormulaForCharacter('1d20+cha', character, 'Persuasion', 'check')).toBeNull();
    expect(
      resolveFormulaForCharacter('1d20+athletics', character, 'Athletics', 'check'),
    ).toBeNull();
  });
});
