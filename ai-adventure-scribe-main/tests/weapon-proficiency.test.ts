/**
 * The rule behind #2541: the engine and the sheet had two answers to "is this character
 * proficient with this weapon". The SRD 5.1 class lists are the answer, and the client class
 * records already carry them, so the shared table is pinned to those records here — if one side
 * gains, loses or renames an entry, this fails.
 *
 * The class list is the floor, not the whole story: a record may add proficiencies of its own
 * (subrace and racial weapon training), and those are honored on top.
 */
import { describe, expect, it } from 'vitest';

import { isWeaponProficient, SRD_CLASS_WEAPON_PROFICIENCIES } from '../shared/weapon-proficiency';
import weaponCatalog from '../src/data/srd/weapons.json';

import { classes } from '@/data/classes';
import { races } from '@/data/races';

describe('the shared proficiency table is the SRD one', () => {
  it.each(classes.map((entry) => [entry.name, entry] as const))(
    '%s matches its class record',
    (_name, entry) => {
      expect(SRD_CLASS_WEAPON_PROFICIENCIES[entry.id]).toEqual(entry.weaponProficiencies);
    },
  );

  it('covers every SRD class', () => {
    expect(Object.keys(SRD_CLASS_WEAPON_PROFICIENCIES).sort()).toEqual(
      classes.map((entry) => entry.id).sort(),
    );
  });
});

describe('a Wizard follows its named list, not every simple weapon', () => {
  const wizard = { className: 'Wizard' };

  it('is proficient with a quarterstaff and a light crossbow', () => {
    expect(isWeaponProficient('quarterstaff', wizard)).toBe(true);
    expect(isWeaponProficient('crossbow-light', wizard)).toBe(true);
  });

  it('is not proficient with a mace or a club (#2541)', () => {
    expect(isWeaponProficient('mace', wizard)).toBe(false);
    expect(isWeaponProficient('club', wizard)).toBe(false);
  });

  it('grants the same for the class id as for the display name', () => {
    // Both directions, so a broken id lookup cannot pass on the "not proficient" answer alone.
    expect(isWeaponProficient('quarterstaff', { className: 'wizard' })).toBe(true);
    expect(isWeaponProficient('mace', { className: 'wizard' })).toBe(false);
  });
});

describe('categories still grant whole categories', () => {
  it.each(['battleaxe', 'greatsword', 'longbow', 'warhammer'])(
    'a Fighter is proficient with %s',
    (weaponId) => {
      expect(isWeaponProficient(weaponId, { className: 'Fighter' })).toBe(true);
    },
  );

  it('a Druid is proficient with its named list, scimitar included', () => {
    expect(isWeaponProficient('scimitar', { className: 'Druid' })).toBe(true);
    expect(isWeaponProficient('sickle', { className: 'Druid' })).toBe(true);
  });

  it('a Warlock keeps the simple-weapons grant and nothing martial', () => {
    expect(isWeaponProficient('dagger', { className: 'Warlock' })).toBe(true);
    expect(isWeaponProficient('longsword', { className: 'Warlock' })).toBe(false);
  });
});

describe('the proficiencies a character record carries', () => {
  it('gives a High Elf Wizard a longsword (#2540)', () => {
    expect(isWeaponProficient('longsword', { className: 'Wizard', subraceName: 'High Elf' })).toBe(
      true,
    );
  });

  it('gives a Dwarf Wizard the dwarf training weapons', () => {
    expect(isWeaponProficient('warhammer', { className: 'Wizard', raceName: 'Dwarf' })).toBe(true);
    expect(isWeaponProficient('battleaxe', { className: 'Wizard', raceName: 'Dwarf' })).toBe(true);
  });

  // Only the High Elf and the dwarves have weapon training in the character records
  // (`src/data/races/elf.ts` gives it to the High Elf alone, `dwarf.ts` to the dwarves), so every
  // other elf subrace and the Mountain Dwarf's armor training must grant no weapon proficiency at
  // all. These are the negatives that the class-table pin cannot see.
  it.each([
    [
      'a Drow Wizard longsword',
      'longsword',
      { className: 'Wizard', raceName: 'Elf', subraceName: 'Drow' },
    ],
    [
      'a Drow Wizard shortsword',
      'shortsword',
      { className: 'Wizard', raceName: 'Elf', subraceName: 'Drow' },
    ],
    [
      'a Wood Elf Wizard longsword',
      'longsword',
      { className: 'Wizard', raceName: 'Elf', subraceName: 'Wood Elf' },
    ],
    [
      'a Wood Elf Wizard shortsword',
      'shortsword',
      { className: 'Wizard', raceName: 'Elf', subraceName: 'Wood Elf' },
    ],
    [
      'a Mountain Dwarf Wizard maul',
      'maul',
      { className: 'Wizard', raceName: 'Dwarf', subraceName: 'Mountain Dwarf' },
    ],
    [
      'a Mountain Dwarf Wizard war pick',
      'war-pick',
      { className: 'Wizard', raceName: 'Dwarf', subraceName: 'Mountain Dwarf' },
    ],
    [
      'a Hill Dwarf Wizard maul',
      'maul',
      { className: 'Wizard', raceName: 'Dwarf', subraceName: 'Hill Dwarf' },
    ],
  ])('%s is not proficient', (_label, weaponId, subject) => {
    expect(isWeaponProficient(weaponId, subject)).toBe(false);
  });

  it.each([
    [
      'a High Elf Wizard',
      { className: 'Wizard', raceName: 'Elf', subraceName: 'High Elf' },
      'longsword',
    ],
    [
      'a Dwarf Wizard',
      { className: 'Wizard', raceName: 'Dwarf', subraceName: 'Hill Dwarf' },
      'warhammer',
    ],
  ])('%s is still proficient with its own training', (_label, subject, weaponId) => {
    expect(isWeaponProficient(weaponId as string, subject)).toBe(true);
  });

  // The sheet reads the lists a race/subrace record carries; the engine, which has only the stored
  // names, does not. A record carrying a list the shared tables do not already grant would put the
  // sheet ahead of the dialog — #2540 all over again. Every current record's list is empty, so this
  // passes; it fails the day one is not, which is when the list belongs in the shared table.
  it.each([
    ...races.map((race) => [race.name, race] as const),
    ...races.flatMap((race) => (race.subraces ?? []).map((sub) => [sub.name, sub] as const)),
  ])('%s adds nothing the shared tables do not already grant', (_name, record) => {
    const carried = record.weaponProficiencies ?? [];
    const withoutList = (id: string): boolean => isWeaponProficient(id, { className: 'Wizard' });
    const withList = (id: string): boolean =>
      isWeaponProficient(id, { className: 'Wizard', carriedProficiencies: carried });

    expect(carried).toEqual([]);
    for (const weapon of weaponCatalog as Array<{ id: string }>) {
      expect(withList(weapon.id)).toBe(withoutList(weapon.id));
    }
  });

  it('honors a carried list the record spells out', () => {
    const subject = { className: 'Wizard', carriedProficiencies: ['Longswords'] };
    expect(isWeaponProficient('longsword', subject)).toBe(true);
    expect(isWeaponProficient('shortsword', subject)).toBe(false);
  });

  it('grants nothing to a weapon the SRD catalog does not know', () => {
    expect(isWeaponProficient('chainsaw-of-cleaving', { className: 'Fighter' })).toBe(false);
  });

  // A magic weapon row carries no SRD id (`src/data/srd/magic-items.json` has no `weaponType`
  // either), so both sides now answer "not proficient" for one instead of the sheet alone saying
  // "proficient". Pinned so the narrowing is a decision on the record, not an accident.
  it('grants nothing to a magic weapon, whose record names no base weapon', () => {
    expect(isWeaponProficient('defender', { className: 'Fighter' })).toBe(false);
    expect(isWeaponProficient('dagger-of-venom', { className: 'Fighter' })).toBe(false);
  });
});

describe('every class against the whole SRD weapon catalog', () => {
  // The class table above pins the strings; this pins what those strings mean. A category grant
  // has to cover every weapon of its category and never one of them, and a named list has to
  // resolve to the weapon it names — across the whole catalog, not a sample of it.
  const catalog = weaponCatalog as Array<{ id: string; weaponType?: string }>;
  const allIds = catalog.map((weapon) => weapon.id);
  const simpleIds = catalog.filter((w) => w.weaponType === 'simple').map((w) => w.id);
  const martialIds = catalog.filter((w) => w.weaponType === 'martial').map((w) => w.id);
  const proficientFor = (className: string): string[] =>
    allIds.filter((weaponId) => isWeaponProficient(weaponId, { className }));

  // PHB p. 112-116: the simple-weapon classes get every simple weapon; the martial ones get those
  // plus every martial one; the rest get the short named list the SRD prints for them.
  const expected: Record<string, string[]> = {
    Barbarian: [...simpleIds, ...martialIds],
    Bard: [...simpleIds, 'crossbow-hand', 'longsword', 'rapier', 'shortsword'],
    Cleric: simpleIds,
    Druid: [
      'club',
      'dagger',
      'dart',
      'javelin',
      'mace',
      'quarterstaff',
      'scimitar',
      'sickle',
      'sling',
      'spear',
    ],
    Fighter: [...simpleIds, ...martialIds],
    Monk: [...simpleIds, 'shortsword'],
    Paladin: [...simpleIds, ...martialIds],
    Ranger: [...simpleIds, ...martialIds],
    Rogue: [...simpleIds, 'crossbow-hand', 'longsword', 'rapier', 'shortsword'],
    Sorcerer: ['dagger', 'dart', 'sling', 'quarterstaff', 'crossbow-light'],
    Warlock: simpleIds,
    Wizard: ['dagger', 'dart', 'sling', 'quarterstaff', 'crossbow-light'],
  };

  it.each(classes.map((entry) => entry.name))('%s', (className) => {
    expect(proficientFor(className).sort()).toEqual(expected[className].sort());
  });
});
