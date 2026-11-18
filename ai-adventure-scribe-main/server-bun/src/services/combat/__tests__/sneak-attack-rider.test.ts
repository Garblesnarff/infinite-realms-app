import { describe, expect, it } from 'bun:test';

import { describeResolvedAttack } from '../attack-narration.js';
import {
  appliesSneakAttackRider,
  sneakAttackDice,
  sneakAttackWeaponQualifies,
  splitResistedSneakTotal,
} from '../sneak-attack-rider.js';

const engineAdvantage = { advantage: true, disadvantage: false, advantageSources: ['hidden'] };

describe('Sneak Attack dice (#1637, 2014 SRD 5.1)', () => {
  it('is ceil(level / 2) d6', () => {
    expect(sneakAttackDice(1, false)).toBe('1d6');
    expect(sneakAttackDice(2, false)).toBe('1d6');
    expect(sneakAttackDice(3, false)).toBe('2d6');
    expect(sneakAttackDice(5, false)).toBe('3d6');
    expect(sneakAttackDice(20, false)).toBe('10d6');
  });

  it('doubles the dice on a critical hit', () => {
    expect(sneakAttackDice(1, true)).toBe('2d6');
    expect(sneakAttackDice(5, true)).toBe('6d6');
  });

  it('is null below level 1', () => {
    expect(sneakAttackDice(0, false)).toBeNull();
    expect(sneakAttackDice(Number.NaN, false)).toBeNull();
  });
});

describe('Sneak Attack weapon check', () => {
  it('qualifies a finesse or ranged weapon', () => {
    expect(sneakAttackWeaponQualifies({ finesse: true, rangedWeapon: false })).toBe(true);
    expect(sneakAttackWeaponQualifies({ finesse: false, rangedWeapon: true })).toBe(true);
  });

  it('does not qualify a plain melee weapon', () => {
    expect(sneakAttackWeaponQualifies({ finesse: false, rangedWeapon: false })).toBe(false);
  });

  it('does not qualify a melee spear, even though it has a throw range', () => {
    // A spear's throw range makes it "ranged" by reach, but it is a melee weapon by category.
    expect(sneakAttackWeaponQualifies({ finesse: false, rangedWeapon: false })).toBe(false);
  });
});

describe('Sneak Attack rider decision (#1637)', () => {
  it('applies with advantage from an engine source', () => {
    expect(
      appliesSneakAttackRider({
        ...engineAdvantage,
        allyWithinReachOfTarget: false,
        alreadyUsedThisTurn: false,
      }),
    ).toBe(true);
  });

  it('does not apply when advantage comes only from the client "requested" flag', () => {
    expect(
      appliesSneakAttackRider({
        advantage: true,
        disadvantage: false,
        advantageSources: ['requested'],
        allyWithinReachOfTarget: false,
        alreadyUsedThisTurn: false,
      }),
    ).toBe(false);
  });

  it('applies with a flanking ally within reach, with no advantage at all', () => {
    expect(
      appliesSneakAttackRider({
        advantage: false,
        disadvantage: false,
        advantageSources: [],
        allyWithinReachOfTarget: true,
        alreadyUsedThisTurn: false,
      }),
    ).toBe(true);
  });

  it('never applies with disadvantage, even beside an ally', () => {
    expect(
      appliesSneakAttackRider({
        advantage: false,
        disadvantage: true,
        advantageSources: [],
        allyWithinReachOfTarget: true,
        alreadyUsedThisTurn: false,
      }),
    ).toBe(false);
  });

  it('applies once per turn only', () => {
    expect(
      appliesSneakAttackRider({
        ...engineAdvantage,
        allyWithinReachOfTarget: true,
        alreadyUsedThisTurn: true,
      }),
    ).toBe(false);
  });

  it('does not apply with neither advantage nor an ally', () => {
    expect(
      appliesSneakAttackRider({
        advantage: false,
        disadvantage: false,
        advantageSources: [],
        allyWithinReachOfTarget: false,
        alreadyUsedThisTurn: false,
      }),
    ).toBe(false);
  });
});

describe('Sneak Attack damage line (#1637)', () => {
  it('reads like the Smite line', () => {
    const line = describeResolvedAttack(
      'Rowan',
      'the orc',
      {
        hit: true,
        autoRolled: true,
        finalDamage: 11,
        isCritical: false,
        targetNewHp: 9,
        targetIsConscious: true,
        damageParts: [
          { damageType: 'piercing', amount: 7 },
          { damageType: 'piercing', amount: 4, source: 'Sneak Attack', dice: '1d6' },
        ],
      },
      'shortbow',
    );
    expect(line).toContain('7 piercing + 4 piercing (Sneak Attack 1d6) = 11 damage');
  });
});

describe('Sneak Attack resistance on the combined total (#1637)', () => {
  const none = { resistances: [], vulnerabilities: [], immunities: [] } as const;

  it('resists the weapon and rider total once: 7 + 3 under resistance is 5, not 3 + 1', () => {
    const split = splitResistedSneakTotal({
      weaponRaw: 7,
      riderRaw: 3,
      damageType: 'piercing',
      ...none,
      resistances: ['piercing'],
    });
    expect(split).toEqual({ weapon: 3, rider: 2 });
    expect(split.weapon + split.rider).toBe(5);
  });

  it('leaves both parts whole without resistance', () => {
    expect(
      splitResistedSneakTotal({ weaponRaw: 7, riderRaw: 3, damageType: 'piercing', ...none }),
    ).toEqual({
      weapon: 7,
      rider: 3,
    });
  });

  it('doubles the combined total once under vulnerability', () => {
    const split = splitResistedSneakTotal({
      weaponRaw: 7,
      riderRaw: 3,
      damageType: 'piercing',
      ...none,
      vulnerabilities: ['piercing'],
    });
    expect(split).toEqual({ weapon: 14, rider: 6 });
  });

  it('takes nothing from either part under immunity', () => {
    const split = splitResistedSneakTotal({
      weaponRaw: 7,
      riderRaw: 3,
      damageType: 'piercing',
      ...none,
      immunities: ['piercing'],
    });
    expect(split).toEqual({ weapon: 0, rider: 0 });
  });
});
