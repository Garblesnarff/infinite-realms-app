import { describe, expect, test } from 'bun:test';

import { capStoryDamage, MAX_STORY_DAMAGE, validDamage } from '../story-damage.js';

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
