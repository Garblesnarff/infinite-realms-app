import { describe, expect, test } from 'bun:test';

import { MAX_STORY_DAMAGE, validDamage } from '../story-damage.js';

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
