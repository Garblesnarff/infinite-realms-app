import { describe, expect, it } from 'bun:test';

import {
  divineSmiteDieCount,
  divineSmiteNotAppliedLine,
  divineSmiteRefusal,
  divineSmiteRefusalText,
} from '../divine-smite-rider.js';

const ready = {
  attackerIsPaladin: true,
  isMeleeWeaponAttack: true,
  slotLevel: 1,
  slotsRemaining: 1,
};

describe('Divine Smite refusal decision (#1362)', () => {
  it('allows a Smite from a Paladin on a melee attack with a slot of that level', () => {
    expect(divineSmiteRefusal(ready)).toBeNull();
  });

  it('refuses a non-Paladin first, whatever else is true', () => {
    expect(divineSmiteRefusal({ ...ready, attackerIsPaladin: false, slotsRemaining: 0 })).toBe(
      'smite_not_paladin',
    );
  });

  it('refuses a ranged attack', () => {
    expect(divineSmiteRefusal({ ...ready, isMeleeWeaponAttack: false })).toBe('smite_not_melee');
  });

  it('refuses when no slot of the declared level is left, before any roll', () => {
    expect(divineSmiteRefusal({ ...ready, slotLevel: 2, slotsRemaining: 0 })).toBe('smite_no_slot');
  });

  it('names the reason and the slot level in the refusal text', () => {
    expect(divineSmiteRefusalText('smite_no_slot', 2)).toBe('no level 2 spell slot left');
    expect(divineSmiteRefusalText('smite_not_melee', 1)).toBe('it needs a melee weapon attack');
  });
});

describe('Divine Smite dice (#1362, 2014 PHB p.85)', () => {
  it('rolls 2d8 at 1st level, plus 1d8 per level above 1st, capped at 5d8', () => {
    expect(divineSmiteDieCount(1, null, false)).toBe(2);
    expect(divineSmiteDieCount(2, null, false)).toBe(3);
    expect(divineSmiteDieCount(4, null, false)).toBe(5);
    expect(divineSmiteDieCount(9, null, false)).toBe(5);
  });

  it('adds 1d8 against undead or fiends', () => {
    expect(divineSmiteDieCount(1, 'undead', false)).toBe(3);
    expect(divineSmiteDieCount(2, 'Fiend (demon)', false)).toBe(4);
    expect(divineSmiteDieCount(1, 'humanoid', false)).toBe(2);
  });

  it('doubles every die on a critical hit, the undead bonus included', () => {
    expect(divineSmiteDieCount(1, null, true)).toBe(4);
    expect(divineSmiteDieCount(1, 'undead', true)).toBe(6);
  });

  it('states a slot that was not spent in the engine line', () => {
    expect(divineSmiteNotAppliedLine(3)).toBe('Divine Smite not applied: no level 3 slot.');
  });
});
