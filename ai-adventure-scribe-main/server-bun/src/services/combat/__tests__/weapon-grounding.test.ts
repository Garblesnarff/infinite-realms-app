import { describe, expect, test } from 'bun:test';

import { groundRequestedWeapon } from '../weapon-grounding.js';

import type { WeaponRuleProfile } from '../combat-rules.js';

/**
 * The rule this file pins: a weapon name read out of narration is a guess, and a guess must
 * never be able to refuse an attack. It may only choose badly, loudly.
 */
const weapon = (over: Partial<WeaponRuleProfile>): WeaponRuleProfile => ({
  id: 'id',
  name: 'Weapon',
  damageDice: '1d6',
  damageType: 'slashing',
  normalRange: 5,
  magicBonus: 0,
  finesse: false,
  ranged: false,
  proficient: true,
  ...over,
});

const LONGBOW = weapon({
  id: 'inv-longbow',
  name: 'Longbow',
  normalRange: 150,
  longRange: 600,
  ranged: true,
  damageDice: '1d8',
});
const SHORTSWORD = weapon({ id: 'inv-shortsword', name: 'Shortsword', finesse: true });
const SHEET = [LONGBOW, SHORTSWORD];

describe('grounding a narrated weapon name against the sheet', () => {
  test('an unclaimed weapon takes the sheet default and is not reported as ungrounded', () => {
    const result = groundRequestedWeapon(null, SHEET);
    expect(result).toMatchObject({ weaponId: 'inv-longbow', grounded: true, requested: null });
  });

  test('a name the sheet backs resolves to that exact row', () => {
    expect(groundRequestedWeapon('shortsword', SHEET)).toMatchObject({
      weaponId: 'inv-shortsword',
      grounded: true,
    });
    // Row ids and display names are both accepted, so every producer of a weapon id agrees.
    expect(groundRequestedWeapon('inv-longbow', SHEET).weaponId).toBe('inv-longbow');
    expect(groundRequestedWeapon('Longbow', SHEET).weaponId).toBe('inv-longbow');
  });

  test('an invented weapon substitutes one of the same attack type, and says so', () => {
    // "Elven greatbow" is not in the SRD, but "greatbow" is not what is matched — the whole
    // slug misses, so there is no type to match and the sheet default stands in.
    const invented = groundRequestedWeapon('elven-greatbow', SHEET);
    expect(invented.grounded).toBe(false);
    expect(invented.requested).toBe('elven-greatbow');

    // A real SRD weapon she does not carry does have a type, and it is honoured: a shortbow
    // claim resolves to her bow, not to the first row that happens to be a sword.
    const swordsFirst = [SHORTSWORD, LONGBOW];
    const shortbow = groundRequestedWeapon('shortbow', swordsFirst);
    expect(shortbow).toMatchObject({ weaponId: 'inv-longbow', grounded: false });
    expect(shortbow.weapon.ranged).toBe(true);

    const rapier = groundRequestedWeapon('rapier', SHEET);
    expect(rapier).toMatchObject({ weaponId: 'inv-shortsword', grounded: false });
    expect(rapier.weapon.ranged).toBe(false);
  });

  test('a character carrying nothing falls back to unarmed strike, never to an error', () => {
    const barehanded = groundRequestedWeapon('greataxe', []);
    expect(barehanded.weapon.name).toBe('Unarmed Strike');
    // Undefined on purpose: unarmed is a rules default, not an equipped row, and passing it on
    // as a weapon id would make resolution reject the very attack this fallback rescued.
    expect(barehanded.weaponId).toBeUndefined();
    expect(barehanded.grounded).toBe(false);
  });

  test('an empty or whitespace claim counts as no claim', () => {
    expect(groundRequestedWeapon('', SHEET).grounded).toBe(true);
    expect(groundRequestedWeapon('   ', SHEET)).toMatchObject({
      weaponId: 'inv-longbow',
      grounded: true,
    });
  });

  test('a punch or unarmed claim is Unarmed Strike even when a rapier is equipped', () => {
    const rapier = weapon({ id: 'inv-rapier', name: 'Rapier', finesse: true });
    const sheet = [rapier];
    for (const claim of [
      'unarmed-strike',
      'unarmed',
      'punch',
      'hit',
      'strike',
      'fist',
      'kick',
      'headbutt',
    ]) {
      const result = groundRequestedWeapon(claim, sheet);
      expect(result.weapon.name).toBe('Unarmed Strike');
      expect(result.weaponId).toBeUndefined();
      expect(result.grounded).toBe(true);
      expect(result.weapon.id).not.toBe('inv-rapier');
    }
  });
});

describe('notEquipped flag (#260)', () => {
  test('marks a requested weapon that is not equipped', () => {
    const handaxe = weapon({ id: 'inv-handaxe', name: 'Handaxe' });
    const sheet = [handaxe];
    const result = groundRequestedWeapon('light-crossbow', sheet);
    expect(result.notEquipped).toBe(true);
    expect(result.grounded).toBe(false);
    expect(result.requested).toBe('light-crossbow');
  });

  test('does not mark notEquipped when the weapon is equipped', () => {
    const crossbow = weapon({ id: 'inv-crossbow', name: 'Light Crossbow', ranged: true });
    const sheet = [crossbow];
    const result = groundRequestedWeapon('light-crossbow', sheet);
    expect(result.notEquipped).toBe(false);
    expect(result.grounded).toBe(true);
  });

  test('does not mark notEquipped when nothing is requested', () => {
    const handaxe = weapon({ id: 'inv-handaxe', name: 'Handaxe' });
    const result = groundRequestedWeapon(null, [handaxe]);
    expect(result.notEquipped).toBe(false);
  });
});
