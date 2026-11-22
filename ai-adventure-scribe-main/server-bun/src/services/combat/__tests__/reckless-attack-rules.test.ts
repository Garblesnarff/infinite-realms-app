import { describe, expect, test } from 'bun:test';

import { recklessAttackRefusal } from '../reckless-attack-rules.js';

describe('Reckless Attack declaration', () => {
  const valid = { barbarianLevel: 2, firstAttack: true, meleeWeapon: true, strengthAttack: true };
  test('allows the first Strength melee weapon attack at Barbarian level 2', () => {
    expect(recklessAttackRefusal(valid)).toBeNull();
  });
  test.each([
    [{ barbarianLevel: 0 }, /Barbarian class/],
    [{ barbarianLevel: 1 }, /level 2/],
    [{ firstAttack: false }, /first attack/],
    [{ meleeWeapon: false }, /melee weapon/],
    [{ strengthAttack: false }, /Strength/],
  ])('refuses an ineligible declaration', (change, reason) => {
    expect(recklessAttackRefusal({ ...valid, ...change })).toMatch(reason);
  });
});
