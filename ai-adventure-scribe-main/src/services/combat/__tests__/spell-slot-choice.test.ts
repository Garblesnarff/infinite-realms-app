import { describe, expect, it } from 'vitest';

import { chooseSpellSlotLevel } from '../../../../shared/spell-slot-choice';

describe('chooseSpellSlotLevel (#1227)', () => {
  it('spends no slot for a cantrip or an unknown level', () => {
    expect(chooseSpellSlotLevel(0)).toBeNull();
    expect(chooseSpellSlotLevel(null)).toBeNull();
    expect(chooseSpellSlotLevel(undefined, { chosen: 2 })).toBeNull();
  });

  it("takes the player's chosen slot when it is at or above the spell's level", () => {
    expect(chooseSpellSlotLevel(1, { chosen: 2 })).toBe(2);
    expect(chooseSpellSlotLevel(2, { chosen: 2 })).toBe(2);
  });

  it('ignores a chosen slot below the spell level', () => {
    expect(chooseSpellSlotLevel(2, { chosen: 1 })).toBe(2);
  });

  it('picks the lowest remaining slot at or above the spell level', () => {
    const remaining = new Map([
      [1, 0],
      [2, 2],
      [3, 1],
    ]);
    expect(chooseSpellSlotLevel(1, { remaining })).toBe(2);
    expect(chooseSpellSlotLevel(3, { remaining })).toBe(3);
  });

  it('is null when no slot at or above the spell level remains', () => {
    expect(
      chooseSpellSlotLevel(2, {
        remaining: new Map([
          [1, 4],
          [2, 0],
        ]),
      }),
    ).toBeNull();
  });

  it("falls back to the spell's own level when nothing is known", () => {
    expect(chooseSpellSlotLevel(1)).toBe(1);
    expect(chooseSpellSlotLevel(2, { remaining: null })).toBe(2);
  });
});
