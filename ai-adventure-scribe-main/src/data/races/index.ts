import { astralborn } from './astralborn';
import { catfolk } from './catfolk';
import { celestialborn } from './celestialborn';
import { dragonborn } from './dragonborn';
import { dwarf } from './dwarf';
import { elementalborn } from './elementalborn';
import { elf } from './elf';
import { forestGiant } from './forest-giant';
import { gnome } from './gnome';
import { halfElf } from './half-elf';
import { halfOrc } from './half-orc';
import { halfling } from './halfling';
import { human } from './human';
import { lizardfolk } from './lizardfolk';
import { ravenfolk } from './ravenfolk';
import { satyr } from './satyr';
import { seaborn } from './seaborn';
import { serpentfolk } from './serpentfolk';
import { stoneGiant } from './stone-giant';
import { tiefling } from './tiefling';

import type { CharacterRace } from '@/types/character';

export const baseRaces: CharacterRace[] = [
  dwarf,
  elf,
  halfling,
  human,
  dragonborn,
  gnome,
  elementalborn,
  celestialborn,
  astralborn,
  tiefling,
  halfElf,
  halfOrc,
  forestGiant,
  stoneGiant,
  ravenfolk,
  lizardfolk,
  catfolk,
  seaborn,
  serpentfolk,
];

export const races = baseRaces;

/**
 * Races that premade characters use but the creation wizard does not offer. Stored
 * characters resolve against `lookupRaces` so a premade never lands on the sheet with an
 * unknown race (#2150).
 */
export const premadeOnlyRaces: CharacterRace[] = [satyr];

export const lookupRaces: CharacterRace[] = [...baseRaces, ...premadeOnlyRaces];

const normalizeRaceKey = (value: unknown): string =>
  (typeof value === 'string' ? value : '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/**
 * Returns the darkvision range in feet for a race (and optional subrace): a number
 * for a known race with darkvision, null for a known race without it, and
 * undefined when the race is missing or unknown so callers make no claim.
 */
export function darkvisionRangeFor(
  raceName: unknown,
  subraceName?: unknown,
): number | null | undefined {
  const raceKey = normalizeRaceKey(raceName);
  if (!raceKey) return undefined;
  const race = lookupRaces.find(
    (r) => normalizeRaceKey(r.name) === raceKey || normalizeRaceKey(r.id) === raceKey,
  );
  if (!race) return undefined;
  const subraceKey = normalizeRaceKey(subraceName);
  const subrace =
    subraceKey && race.subraces
      ? race.subraces.find(
          (s) => normalizeRaceKey(s.name) === subraceKey || normalizeRaceKey(s.id) === subraceKey,
        )
      : undefined;
  const traits = [...(race.traits ?? []), ...(subrace?.traits ?? [])];
  if (traits.includes('Superior Darkvision')) return 120;
  if (traits.includes('Darkvision')) return 60;
  return null;
}
