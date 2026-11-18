import { describe, expect, it } from 'bun:test';

import { describeResolvedAttack } from '../attack-narration.js';
import {
  appliesSneakAttackRider,
  sneakAttackDice,
  sneakAttackWeaponQualifies,
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
    expect(sneakAttackWeaponQualifies({ finesse: true, ranged: false })).toBe(true);
    expect(sneakAttackWeaponQualifies({ finesse: false, ranged: true })).toBe(true);
  });

  it('does not qualify a plain melee weapon', () => {
    expect(sneakAttackWeaponQualifies({ finesse: false, ranged: false })).toBe(false);
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
