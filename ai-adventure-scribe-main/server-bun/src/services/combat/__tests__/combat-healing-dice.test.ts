/**
 * Leaf parser tests (FIX round, #1147): `parseHealingDice` lives in
 * `combat-healing-dice.ts` with no imports, so this suite needs no mocks —
 * the same assertions the resolver suite used to carry, moved with the parser.
 */
import { describe, expect, test } from 'bun:test';

import { parseHealingDice } from '../combat-healing-dice.js';

describe('parseHealingDice', () => {
  test('parses NdM, NdM+K and NdM-K; rejects everything else', () => {
    expect(parseHealingDice('2d4+2')).toEqual({ count: 2, sides: 4, modifier: 2 });
    expect(parseHealingDice('1d8')).toEqual({ count: 1, sides: 8, modifier: 0 });
    expect(parseHealingDice('2d4-1')).toEqual({ count: 2, sides: 4, modifier: -1 });
    expect(parseHealingDice('d4')).toBeNull();
    expect(parseHealingDice('2d')).toBeNull();
    expect(parseHealingDice('heal')).toBeNull();
    expect(parseHealingDice('')).toBeNull();
    expect(parseHealingDice(null)).toBeNull();
    expect(parseHealingDice('0d4')).toBeNull();
    expect(parseHealingDice('2d0')).toBeNull();
  });
});
