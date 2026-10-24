import { describe, expect, it } from 'vitest';

import {
  defenseArmorClassBonus,
  duelingDamageBonus,
  greatWeaponFightingApplies,
  rerollGreatWeaponFace,
} from '../shared/fighting-style';

describe('fighting style owner (#824)', () => {
  it('gives Defense +1 only while armor is worn, once', () => {
    expect(defenseArmorClassBonus(['Defense', 'defense'], true)).toBe(1);
    expect(defenseArmorClassBonus(['defense'], false)).toBe(0);
    expect(defenseArmorClassBonus(['archery'], true)).toBe(0);
  });

  it('rerolls a Great Weapon Fighting 1 or 2 once and keeps the new face', () => {
    expect(rerollGreatWeaponFace(1, () => 1)).toBe(1);
    expect(rerollGreatWeaponFace(2, () => 6)).toBe(6);
    expect(rerollGreatWeaponFace(3, () => 1)).toBe(3);
  });

  it('applies Great Weapon Fighting to a two-handed melee weapon only', () => {
    expect(
      greatWeaponFightingApplies(['Great Weapon Fighting'], { meleeWeapon: true, twoHanded: true }),
    ).toBe(true);
    expect(
      greatWeaponFightingApplies(['great_weapon_fighting'], {
        meleeWeapon: true,
        twoHanded: false,
      }),
    ).toBe(false);
    expect(
      duelingDamageBonus(['dueling'], {
        meleeWeapon: true,
        twoHanded: false,
        otherWeaponWielded: false,
      }),
    ).toBe(2);
  });
});
