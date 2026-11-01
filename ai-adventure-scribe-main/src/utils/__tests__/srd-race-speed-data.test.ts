/**
 * #1251: the combat movement budget reads the character's speed. These tests pin
 * the shared race-speed table the engine reads, and keep it aligned with the
 * race records the sheet loader resolves (`src/data/races/*`) — a race-speed
 * change there fails here until the shared table follows.
 *
 * Producers: the race records in `src/data/races/*` (via `lookupRaces`), the
 * same records `getBaseSpeed` reads through the resolved character. The sheet
 * shows SPD 25 for a gnome because the Gnome record carries 25; the engine must
 * seat the same 25.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_WALK_SPEED,
  RACE_WALK_SPEEDS,
  SUBRACE_WALK_SPEEDS,
  resolveCharacterCombatSpeed,
  resolveRaceSpeed,
} from '../../../shared/srd-race-speed-data';

import { lookupRaces } from '@/data/races';

describe('resolveRaceSpeed', () => {
  it.each([
    ['Gnome', undefined, 25],
    ['Gnome', 'Forest Gnome', 25],
    ['Gnome', 'Rock Gnome', 25],
    ['Gnome', 'Deep Gnome (Svirfneblin)', 25],
    ['Elf', 'Wood Elf', 35],
    ['Elf', 'High Elf', 30],
    ['Elf', 'Drow (Dark Elf)', 30],
    ['Dwarf', 'Hill Dwarf', 25],
    ['Dwarf', 'Mountain Dwarf', 25],
    ['Halfling', 'Lightfoot Halfling', 25],
    ['Halfling', 'Stout Halfling', 25],
    ['Satyr', undefined, 35],
    ['Human', undefined, 30],
    ['Human', 'Custom Lineage', 30],
  ])('%s / %s walks at %s ft', (race, subrace, expected) => {
    expect(resolveRaceSpeed(race, subrace)).toBe(expected);
  });

  it('falls back to 30 for an unknown race and for missing names', () => {
    expect(resolveRaceSpeed('Not A Race', undefined)).toBe(30);
    expect(resolveRaceSpeed(null, null)).toBe(30);
    expect(resolveRaceSpeed(undefined, undefined)).toBe(30);
    expect(resolveRaceSpeed('Elf', null)).toBe(30);
    expect(resolveRaceSpeed('', '')).toBe(30);
  });

  it('matches names case-insensitively after trimming', () => {
    expect(resolveRaceSpeed(' GNOME ', undefined)).toBe(25);
    expect(resolveRaceSpeed('elf', ' wood elf ')).toBe(35);
  });

  it('matches names with punctuation dropped, as the sheet record lookup does', () => {
    expect(resolveRaceSpeed('Elf', 'Wood-Elf')).toBe(35);
    expect(resolveRaceSpeed('Elf', 'WoodElf')).toBe(35);
    expect(resolveRaceSpeed('Elf', 'wood_elf')).toBe(35);
    expect(resolveRaceSpeed('Gnome', 'Rock-Gnome')).toBe(25);
  });
});

describe('resolveCharacterCombatSpeed', () => {
  it('prefers an explicitly stored non-default speed', () => {
    expect(resolveCharacterCombatSpeed(40, 'Gnome', undefined)).toBe(40);
    expect(resolveCharacterCombatSpeed(35, 'Elf', 'High Elf')).toBe(35);
  });

  it('reads the race base when the stored speed is the column default', () => {
    expect(resolveCharacterCombatSpeed(30, 'Gnome', undefined)).toBe(25);
    expect(resolveCharacterCombatSpeed(30, 'Elf', 'Wood Elf')).toBe(35);
  });

  it('reads the race base when the stored speed is missing or invalid', () => {
    expect(resolveCharacterCombatSpeed(null, 'Elf', 'Wood Elf')).toBe(35);
    expect(resolveCharacterCombatSpeed(undefined, 'Dwarf', undefined)).toBe(25);
    expect(resolveCharacterCombatSpeed(NaN, 'Halfling', undefined)).toBe(25);
    expect(resolveCharacterCombatSpeed(0, 'Gnome', undefined)).toBe(25);
    expect(resolveCharacterCombatSpeed(-5, 'Gnome', undefined)).toBe(25);
  });
});

describe('SRD race-speed table alignment', () => {
  it('covers every playable race with the record speed', () => {
    const missing = lookupRaces
      .map((race) => race.name)
      .filter((name) => RACE_WALK_SPEEDS[name] === undefined);
    expect(missing).toEqual([]);
    for (const race of lookupRaces) {
      expect(RACE_WALK_SPEEDS[race.name]).toBe(race.speed);
    }
  });

  it('agrees with every subrace speed the records define', () => {
    for (const race of lookupRaces) {
      for (const subrace of race.subraces ?? []) {
        if (subrace.speed !== undefined) {
          expect(SUBRACE_WALK_SPEEDS[subrace.name]).toBe(subrace.speed);
        }
      }
    }
  });

  it('has no entries for races or subraces that do not exist', () => {
    const knownRaces = new Set(lookupRaces.map((race) => race.name));
    const knownSubraces = new Set(
      lookupRaces.flatMap((race) => (race.subraces ?? []).map((subrace) => subrace.name)),
    );
    expect(Object.keys(RACE_WALK_SPEEDS).filter((name) => !knownRaces.has(name))).toEqual([]);
    expect(Object.keys(SUBRACE_WALK_SPEEDS).filter((name) => !knownSubraces.has(name))).toEqual([]);
  });

  it('keeps the 30 default shared with getBaseSpeed', () => {
    expect(DEFAULT_WALK_SPEED).toBe(30);
  });
});
