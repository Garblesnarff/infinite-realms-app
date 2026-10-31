import { describe, expect, test } from 'bun:test';

import {
  capStoryDamage,
  fallDiceFromHeight,
  MAX_STORY_DAMAGE,
  rollFallDamage,
  validDamage,
} from '../story-damage.js';

// #610 (#218 step 6): the `damage` envelope field's server-side shape check. The model
// writes this field, so only a well-formed claim may move hit points.
describe('validDamage (#610)', () => {
  test('accepts a well-formed story damage claim', () => {
    expect(validDamage({ amount: 3, source: 'rope burn' })).toBe(true);
  });

  test('accepts the maximum', () => {
    expect(validDamage({ amount: MAX_STORY_DAMAGE, source: 'fall' })).toBe(true);
  });

  test('rejects zero, negative and fractional amounts', () => {
    expect(validDamage({ amount: 0, source: 'rope burn' })).toBe(false);
    expect(validDamage({ amount: -2, source: 'rope burn' })).toBe(false);
    expect(validDamage({ amount: 2.5, source: 'rope burn' })).toBe(false);
  });

  test('rejects an amount above the per-turn cap', () => {
    expect(validDamage({ amount: MAX_STORY_DAMAGE + 1, source: 'fall' })).toBe(false);
  });

  test('rejects a missing, empty or overlong source', () => {
    expect(validDamage({ amount: 3 })).toBe(false);
    expect(validDamage({ amount: 3, source: '' })).toBe(false);
    expect(validDamage({ amount: 3, source: '   ' })).toBe(false);
    expect(validDamage({ amount: 3, source: 'x'.repeat(121) })).toBe(false);
  });

  test('rejects non-objects', () => {
    expect(validDamage(null)).toBe(false);
    expect(validDamage(undefined)).toBe(false);
    expect(validDamage('3 damage')).toBe(false);
    expect(validDamage([{ amount: 3, source: 'rope burn' }])).toBe(false);
  });
});

// #768 FIX: story damage never kills outright. The per-hit half-max net is off on this
// path, so the cap is the only thing between an inflated claim and an instant death.
describe('capStoryDamage (#768 FIX)', () => {
  test('caps an inflated claim at current HP minus 1 (25 on 12)', () => {
    expect(capStoryDamage(25, 12, 12)).toBe(11);
  });

  test('caps an absurd claim at current HP minus 1 (999 on 12)', () => {
    expect(capStoryDamage(999, 12, 12)).toBe(11);
  });

  test('leaves an honest claim alone', () => {
    expect(capStoryDamage(5, 12, 12)).toBe(5);
    expect(capStoryDamage(1, 12, 12)).toBe(1);
    expect(capStoryDamage(12, 12, 12)).toBe(11);
  });

  test('at 1 HP the claim is capped at 1: it may drop the hero to 0 (dying), never kill', () => {
    expect(capStoryDamage(999, 1, 12)).toBe(1);
    expect(capStoryDamage(1, 1, 12)).toBe(1);
  });

  test('at 0 HP the claim is capped below the maximum: one failure per hit, never instant death', () => {
    expect(capStoryDamage(999, 0, 12)).toBe(11);
    expect(capStoryDamage(3, 0, 12)).toBe(3);
  });
});

// #777: 2014 PHB p.183 — 1d6 bludgeoning per 10 feet fallen, maximum 20d6.
// The dice count is pure (no RNG), so these pin the formula exactly.
describe('fallDiceFromHeight (#777)', () => {
  test('a fall under 10 feet deals no damage', () => {
    expect(fallDiceFromHeight(0)).toBe(0);
    expect(fallDiceFromHeight(9)).toBe(0);
  });

  test('whole 10-foot bands only', () => {
    expect(fallDiceFromHeight(10)).toBe(1);
    expect(fallDiceFromHeight(35)).toBe(3);
    expect(fallDiceFromHeight(199)).toBe(19);
  });

  test('the cap binds at 20d6', () => {
    expect(fallDiceFromHeight(200)).toBe(20);
    expect(fallDiceFromHeight(250)).toBe(20);
    expect(fallDiceFromHeight(1000)).toBe(20);
  });
});

describe('rollFallDamage (#777)', () => {
  test('a fixed RNG pins every die', () => {
    expect(rollFallDamage(35, () => 0)).toBe(3);
    expect(rollFallDamage(35, () => 0.999999)).toBe(18);
  });

  test('zero dice rolls zero', () => {
    expect(rollFallDamage(9, () => 0.999999)).toBe(0);
  });
});

describe('validDamage fall height (#777)', () => {
  test('accepts a whole non-negative height', () => {
    expect(validDamage({ amount: 999, source: 'fall', fallHeightFeet: 35 })).toBe(true);
    expect(validDamage({ amount: 1, source: 'fall', fallHeightFeet: 0 })).toBe(true);
  });

  test("accepts a claim with no height (today's path)", () => {
    expect(validDamage({ amount: 3, source: 'rope burn' })).toBe(true);
  });

  test('a height ignores an out-of-range model amount (#777 Round 2)', () => {
    // Strategist FIX at 5b2e41a8: the amount range is skipped when a height is
    // present — previously both of these dropped as invalid_damage.
    expect(validDamage({ amount: 1000, source: 'fall', fallHeightFeet: 250 })).toBe(true);
    expect(validDamage({ amount: 0, source: 'fall', fallHeightFeet: 250 })).toBe(true);
  });

  test('rejects a malformed height and fails the whole claim closed', () => {
    expect(validDamage({ amount: 3, source: 'fall', fallHeightFeet: -1 })).toBe(false);
    expect(validDamage({ amount: 3, source: 'fall', fallHeightFeet: 2.5 })).toBe(false);
    expect(validDamage({ amount: 3, source: 'fall', fallHeightFeet: '35' })).toBe(false);
    // The strict schema cannot express null for this field, so a null reaching
    // the server is malformed input, not a "fall with unknown height".
    expect(validDamage({ amount: 3, source: 'fall', fallHeightFeet: null })).toBe(false);
  });
});
