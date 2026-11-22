import { describe, expect, test } from 'bun:test';

import { resolveAttackRules, type WeaponRuleProfile } from '../combat-rules.js';
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

describe('Reckless Attack advantage', () => {
  const weapon: WeaponRuleProfile = {
    id: 'sword',
    name: 'Longsword',
    damageDice: '1d8',
    damageType: 'slashing',
    normalRange: 5,
    magicBonus: 0,
    finesse: false,
    ranged: false,
    proficient: true,
    meleeWeapon: true,
  };
  const base = { strength: 16, dexterity: 12, level: 2, baseTargetAc: 12, weapon };
  test('adds the attacker source only to Strength melee weapon attacks', () => {
    expect(resolveAttackRules({ ...base, attackerReckless: true })).toMatchObject({
      advantage: true,
      advantageSources: ['Reckless Attack'],
    });
    expect(
      resolveAttackRules({
        ...base,
        attackerReckless: true,
        weapon: { ...weapon, finesse: true },
        dexterity: 18,
      }).advantage,
    ).toBe(false);
    expect(
      resolveAttackRules({ ...base, attackerReckless: true, weapon: { ...weapon, ranged: true } })
        .advantage,
    ).toBe(false);
  });
  test('grants advantage to attacks against a reckless target and cancels with disadvantage', () => {
    expect(resolveAttackRules({ ...base, targetReckless: true })).toMatchObject({
      advantage: true,
      advantageSources: ['target used Reckless Attack'],
    });
    expect(
      resolveAttackRules({ ...base, targetReckless: true, requestedDisadvantage: true }),
    ).toMatchObject({ advantage: false, disadvantage: false });
  });
});
