import { describe, expect, it } from 'bun:test';

import { parseBoundedSpellLevel } from '../spell-level-parser.js';

describe('parseBoundedSpellLevel', () => {
  it('accepts complete integer inputs inside the requested range', () => {
    expect(parseBoundedSpellLevel('1', 1, 20)).toBe(1);
    expect(parseBoundedSpellLevel('09', 0, 9)).toBe(9);
    expect(parseBoundedSpellLevel('20', 1, 20)).toBe(20);
  });

  it('rejects partial, fractional, signed, and non-finite inputs', () => {
    for (const value of ['1level', '1.5', '+1', '-1', 'Infinity', '']) {
      expect(parseBoundedSpellLevel(value, 0, 20)).toBeNull();
    }
  });

  it('rejects otherwise valid integers outside the requested range', () => {
    expect(parseBoundedSpellLevel('0', 1, 20)).toBeNull();
    expect(parseBoundedSpellLevel('21', 1, 20)).toBeNull();
    expect(parseBoundedSpellLevel('10', 0, 9)).toBeNull();
  });
});
