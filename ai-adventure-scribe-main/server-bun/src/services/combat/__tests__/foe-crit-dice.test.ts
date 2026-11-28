/**
 * 2014: a critical hit rolls the damage dice twice; a flat number is not doubled.
 *
 * Authored foe damage is stored as dice plus a separate addend (`2d10+4` becomes
 * `{ dice: '2d10', bonus: 4 }` via `splitDamageDice` / `resolveMonsterAttackProfile`).
 * `resolveAttack` then calls `calculateDamage` with those fields and `isCritical`.
 * These tests drive that same pair so a crit cannot silently fall back to a single
 * roll or to the printed average.
 */
import { describe, expect, test } from 'bun:test';

import { calculateDamage } from '../damage-calculator.js';
import { resolveMonsterAttackProfile, splitDamageDice } from '../monster-attack-profile.js';

import type { DamageType } from '../../../types/combat.js';

function rollFoeDamage(
  attack: { damageDice: string; damageBonus: number; damageType: string },
  isCritical: boolean,
  faces: number[],
) {
  let index = 0;
  return calculateDamage({
    damageDice: attack.damageDice,
    damageBonus: attack.damageBonus,
    damageType: attack.damageType as DamageType,
    isCritical,
    adjustDamageDie: () => {
      const face = faces[index];
      if (face === undefined) {
        throw new Error(`expected ${faces.length} damage dice, got a ${index + 1}th roll`);
      }
      index += 1;
      return face;
    },
  });
}

describe('a foe critical hit rolls its damage dice twice', () => {
  test('an authored 1d8 slashing crit rolls two d8, not one die and not a doubled first roll', () => {
    const profile = resolveMonsterAttackProfile({
      authored: { attackBonus: 3, damageDice: '1d8', damageType: 'slashing' },
    });
    expect(profile.source).toBe('authored');
    const attack = profile.attacks[0];
    expect(attack).toMatchObject({ damageDice: '1d8', damageBonus: 0, damageType: 'slashing' });

    const result = rollFoeDamage(attack!, true, [2, 7]);
    expect(result.finalDamage).toBe(9);
    // A single d8 would be 2. Doubling the first face would be 4. The printed average is 4.5.
  });

  test('an authored 2d10+4 crit rolls four d10 and adds the +4 once', () => {
    const profile = resolveMonsterAttackProfile({
      authored: { attackBonus: 7, damageDice: '2d10+4', damageType: 'fire' },
    });
    expect(profile.source).toBe('authored');
    const attack = profile.attacks[0];
    expect(attack).toMatchObject({ damageDice: '2d10', damageBonus: 4, damageType: 'fire' });

    const result = rollFoeDamage(attack!, true, [1, 2, 3, 4]);
    expect(result.finalDamage).toBe(14);
    // No-crit is 1+2+4 = 7. Doubling the first two faces is 6+4 = 10. Doubling the bonus is 18.
  });

  test('a flat number is not doubled on a critical hit', () => {
    const split = splitDamageDice('5');
    expect(split).toEqual({ dice: '0d1', bonus: 5 });
    const result = rollFoeDamage(
      { damageDice: split!.dice, damageBonus: split!.bonus, damageType: 'slashing' },
      true,
      [],
    );
    expect(result.finalDamage).toBe(5);
  });
});
