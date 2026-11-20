/**
 * The off-hand attack's rules on the pure resolver (#1639, 2014 SRD 5.1): its damage takes no ability
 * modifier unless that modifier is negative, and the attack roll keeps its modifier. The light property
 * comes from the SRD catalog.
 */
import { describe, expect, it } from 'bun:test';

import { resolveAttackRules, type WeaponRuleProfile } from '../combat-rules';
import { findCatalogWeapon } from '../weapon-catalog';

const dagger: WeaponRuleProfile = {
  id: 'dagger',
  name: 'Dagger',
  damageDice: '1d4',
  damageType: 'piercing',
  normalRange: 5,
  magicBonus: 0,
  finesse: true,
  ranged: false,
  proficient: true,
  meleeWeapon: true,
  light: true,
};

const base = {
  level: 3,
  baseTargetAc: 12,
  weapon: dagger,
  fightingStyles: [],
};

describe('off-hand attack damage (#1639)', () => {
  it('takes no positive ability modifier on the off-hand damage, and keeps it on the attack roll', () => {
    const plain = resolveAttackRules({ ...base, strength: 16, dexterity: 10 });
    const off = resolveAttackRules({ ...base, strength: 16, dexterity: 10, offHand: true });
    expect(plain.damageBonus).toBe(3);
    expect(off.damageBonus).toBe(0);
    expect(off.attackBonus).toBe(plain.attackBonus);
  });

  it('keeps a negative ability modifier on the off-hand damage', () => {
    // A finesse dagger takes the higher of Strength and Dexterity, so Dexterity 6 (-2) leaves Strength 8 (-1).
    const off = resolveAttackRules({ ...base, strength: 8, dexterity: 6, offHand: true });
    expect(off.damageBonus).toBe(-1);
  });

  it('leaves the magic bonus on the off-hand damage', () => {
    const off = resolveAttackRules({
      ...base,
      weapon: { ...dagger, magicBonus: 1 },
      strength: 16,
      dexterity: 10,
      offHand: true,
    });
    expect(off.damageBonus).toBe(1);
  });
});

describe('light weapons in the SRD catalog (#1639)', () => {
  it('marks Shortsword and Dagger light and Longsword not light', () => {
    expect(findCatalogWeapon('Shortsword')?.weaponProperties?.light).toBe(true);
    expect(findCatalogWeapon('Dagger')?.weaponProperties?.light).toBe(true);
    expect(findCatalogWeapon('Longsword')?.weaponProperties?.light).toBeFalsy();
  });
});
