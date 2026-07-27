/**
 * The arithmetic of party scaling, checked against numbers that can be verified by hand.
 *
 * Every case here uses a real stat block rather than an invented one, because the point of the
 * factor is that it produces a *playable* fight from a *published* creature, and a fabricated
 * `10d10` proves nothing about either. The Unwashed Dish is quoted from run 17's telemetry;
 * the Stone Golem's `3d8+6` is the SRD's printed Slam.
 */
import { describe, expect, test } from 'bun:test';

import {
  PARTY_SIZE_BASELINE,
  averageDamage,
  partyScaleFactor,
  scaleAttackDamage,
  scaleHitPoints,
  scaleMonsterForParty,
} from '../party-scaling.js';

import type { MonsterAttack } from '../monster-attack-profile.js';

const attack = (damageDice: string, damageBonus = 0): MonsterAttack => ({
  name: 'Slam',
  attackBonus: 10,
  damageDice,
  damageBonus,
  damageType: 'bludgeoning',
  normalRange: 5,
  ranged: false,
});

describe('the factor', () => {
  test('is partySize / 4, the party size every published stat block is priced for', () => {
    expect(PARTY_SIZE_BASELINE).toBe(4);
    expect(partyScaleFactor(1)).toBe(0.25);
    expect(partyScaleFactor(2)).toBe(0.5);
    expect(partyScaleFactor(3)).toBe(0.75);
    expect(partyScaleFactor(4)).toBe(1);
  });

  test('never exceeds 1: a larger party does not make a creature stronger than its author wrote', () => {
    expect(partyScaleFactor(5)).toBe(1);
    expect(partyScaleFactor(12)).toBe(1);
  });

  test('degrades to the most protective answer rather than throwing on a bad count', () => {
    expect(partyScaleFactor(0)).toBe(0.25);
    expect(partyScaleFactor(-3)).toBe(0.25);
    expect(partyScaleFactor(Number.NaN)).toBe(0.25);
  });
});

describe('hit points', () => {
  test('scale linearly, and never below 1', () => {
    expect(scaleHitPoints(100, 0.25)).toBe(25);
    expect(scaleHitPoints(100, 0.5)).toBe(50);
    expect(scaleHitPoints(100, 1)).toBe(100);
    expect(scaleHitPoints(2, 0.25)).toBe(1);
  });
});

describe('damage', () => {
  test("the Unwashed Dish's derived 5d6 becomes a fight a solo character survives", () => {
    // 100 HP -> CR 2 -> 17 damage/round -> 5d6 (average 17.5) against an 11 HP character.
    const raw = attack('5d6');
    expect(averageDamage(raw)).toBe(17.5);

    const solo = scaleAttackDamage(raw, partyScaleFactor(1));
    expect(solo.damageDice).toBe('1d6');
    expect(solo.damageBonus).toBe(1);
    // Maximum 7 against 11 hit points: no roll on this attack can remove the character.
    expect(averageDamage(solo)).toBe(4.5);
  });

  test("the Stone Golem's printed 3d8+6 refits to the same die at a quarter of the average", () => {
    const raw = attack('3d8', 6);
    expect(averageDamage(raw)).toBe(19.5);

    const solo = scaleAttackDamage(raw, partyScaleFactor(1));
    expect(solo.damageDice).toBe('1d8');
    expect(solo.damageBonus).toBe(1);
    expect(averageDamage(solo)).toBe(5.5);

    const pair = scaleAttackDamage(raw, partyScaleFactor(2));
    expect(pair.damageDice).toBe('2d8');
    expect(pair.damageBonus).toBe(1);
    expect(averageDamage(pair)).toBe(10);
  });

  test('a full party gets the printed expression back, untouched and identical', () => {
    const raw = attack('3d8', 6);
    expect(scaleAttackDamage(raw, partyScaleFactor(4))).toBe(raw);
  });

  test('never drops below one die of the original size, and says so by not pretending otherwise', () => {
    // 1d4 averages 2.5; a quarter of that is below anything a d4 can express.
    const tiny = scaleAttackDamage(attack('1d4'), 0.25);
    expect(tiny.damageDice).toBe('1d4');
    expect(tiny.damageBonus).toBe(0);
  });

  test('leaves an unreadable damage expression alone rather than guessing at it', () => {
    const odd = attack('3d8+2d6');
    expect(scaleAttackDamage(odd, 0.25)).toBe(odd);
  });
});

describe('a whole monster', () => {
  const profile = {
    source: 'derived' as const,
    attacks: [attack('5d6')],
    derivation: { fromMaxHp: 100, challengeRating: '2', damagePerRound: 17 },
  };

  test('records the raw numbers it was fitted from, so the adjustment can be undone', () => {
    const solo = scaleMonsterForParty({
      rawMaxHp: 100,
      rawCurrentHp: 100,
      attackProfile: profile,
      partySize: 1,
    });
    expect(solo.maxHp).toBe(25);
    expect(solo.currentHp).toBe(25);
    expect(solo.attackProfile?.partyScaling).toEqual({
      partySize: 1,
      baseline: 4,
      factor: 0.25,
      rawMaxHp: 100,
      scaledMaxHp: 25,
      rawAttacks: ['5d6 (avg 17.5)'],
    });
  });

  test('scales both sides together — the point of the whole exercise', () => {
    const solo = scaleMonsterForParty({
      rawMaxHp: 100,
      rawCurrentHp: 100,
      attackProfile: profile,
      partySize: 1,
    });
    const full = scaleMonsterForParty({
      rawMaxHp: 100,
      rawCurrentHp: 100,
      attackProfile: profile,
      partySize: 4,
    });

    // Hit points and damage move together. Scaling only the damage would leave the solo
    // player grinding fourteen rounds through a creature that can no longer threaten them.
    expect(solo.maxHp).toBe(full.maxHp / 4);
    expect(averageDamage(solo.attackProfile!.attacks[0])).toBeLessThan(
      averageDamage(full.attackProfile!.attacks[0]) / 3,
    );
    expect(full.attackProfile!.attacks[0].damageDice).toBe('5d6');
  });

  test('a damaged creature keeps its proportion of health, not its absolute hit points', () => {
    const half = scaleMonsterForParty({
      rawMaxHp: 100,
      rawCurrentHp: 50,
      attackProfile: profile,
      partySize: 1,
    });
    expect(half.maxHp).toBe(25);
    expect(half.currentHp).toBe(13);
  });
});
