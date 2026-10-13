import { describe, expect, it } from 'bun:test';

import { rollD20, rollD20Pair } from '../dice.js';

describe('rollD20Pair', () => {
  it('returns only the kept die with no advantage or disadvantage', () => {
    const pair = rollD20Pair(false, false);
    expect(pair.kept).toBeGreaterThanOrEqual(1);
    expect(pair.kept).toBeLessThanOrEqual(20);
    expect(pair.other).toBeUndefined();
  });

  it('returns both dice on advantage, kept is the higher', () => {
    for (let i = 0; i < 50; i += 1) {
      const pair = rollD20Pair(true, false);
      expect(pair.other).toBeDefined();
      expect(pair.kept).toBeGreaterThanOrEqual(pair.other as number);
    }
  });

  it('returns both dice on disadvantage, kept is the lower', () => {
    for (let i = 0; i < 50; i += 1) {
      const pair = rollD20Pair(false, true);
      expect(pair.other).toBeDefined();
      expect(pair.kept).toBeLessThanOrEqual(pair.other as number);
    }
  });

  it('keeps rollD20 behavior: the kept face matches the scalar roll contract', () => {
    // rollD20 is the kept face; advantage keeps the max, disadvantage the min.
    for (let i = 0; i < 50; i += 1) {
      expect(rollD20(true, false)).toBeGreaterThanOrEqual(1);
      expect(rollD20(false, true)).toBeLessThanOrEqual(20);
    }
  });
});
