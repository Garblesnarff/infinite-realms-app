/**
 * SRD race/subrace walking speeds in feet (#1251).
 *
 * The single source the combat engine reads so the movement budget matches the
 * sheet's SPD tile. The sheet loader resolves a character's race record from
 * `src/data/races/*` and `getBaseSpeed` reads `subrace?.speed || race?.speed || 30`;
 * this table mirrors those records: race speeds for every playable race, and
 * subrace speeds only where the record defines one (every other subrace inherits
 * its race base — Forest Gnome has no speed of its own, so it walks at the Gnome
 * 25). `src/utils/__tests__/srd-race-speed-data.test.ts` keeps this table aligned
 * with the race records, so a race-speed change in `src/data/races/*` fails there
 * until this table follows.
 *
 * Keys are display names, matched case-insensitively after trimming, and with
 * every non-alphanumeric character dropped ("Wood-Elf" matches "Wood Elf"), the
 * same rule the sheet's record lookup uses (src/utils/character/data-transformers.ts):
 * the server only has the characters row's race/subrace text, not the resolved records.
 */

export const RACE_WALK_SPEEDS: Record<string, number> = {
  Astralborn: 30,
  Catfolk: 30,
  Celestialborn: 30,
  Dragonborn: 30,
  Dwarf: 25,
  Elementalborn: 30,
  Elf: 30,
  'Forest Giant': 30,
  Gnome: 25,
  'Half-Elf': 30,
  'Half-Orc': 30,
  Halfling: 25,
  Human: 30,
  Lizardfolk: 30,
  Ravenfolk: 30,
  Satyr: 35,
  Seaborn: 30,
  Serpentfolk: 30,
  'Stone Giant': 30,
  Tiefling: 30,
};

/**
 * Subrace speeds the records define. Only Wood Elf differs from its race base;
 * Custom Lineage is listed because its record defines 30 explicitly — the table
 * mirrors the records exactly, not just the overrides.
 */
export const SUBRACE_WALK_SPEEDS: Record<string, number> = {
  'Wood Elf': 35,
  'Custom Lineage': 30,
};

/** Fallback when neither the subrace nor the race is known, matching getBaseSpeed. */
export const DEFAULT_WALK_SPEED = 30;

/**
 * The character_stats.speed column default (db/schema/game.ts). A stored speed
 * equal to it reads as "never set": the column is only ever written by an
 * explicit character edit, so a row left at the default carries no information
 * and the race base wins. See resolveCharacterCombatSpeed.
 */
export const DEFAULT_STORED_SPEED = 30;

function normalizeName(name: string | null | undefined): string {
  return (name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function lookup(
  table: Record<string, number>,
  name: string | null | undefined,
): number | undefined {
  const key = normalizeName(name);
  if (!key) return undefined;
  for (const [label, speed] of Object.entries(table)) {
    if (normalizeName(label) === key) return speed;
  }
  return undefined;
}

/**
 * A character's walking speed from race alone, mirroring getBaseSpeed:
 * subrace speed, else race speed, else the 30 default.
 */
export function resolveRaceSpeed(
  race: string | null | undefined,
  subrace: string | null | undefined,
): number {
  return (
    lookup(SUBRACE_WALK_SPEEDS, subrace) ?? lookup(RACE_WALK_SPEEDS, race) ?? DEFAULT_WALK_SPEED
  );
}

/**
 * A player character's combat speed (#1251).
 *
 * A stored speed that differs from the column default is an explicit speed
 * (character edit, magic item, homebrew) and wins. A stored speed equal to the
 * default — or missing, non-finite, or non-positive — reads as "never set" and
 * the race base wins, matching the sheet. (An edit to exactly 30 reads as
 * unset; the race base wins there too, still matching the sheet.)
 */
export function resolveCharacterCombatSpeed(
  storedSpeed: unknown,
  race: string | null | undefined,
  subrace: string | null | undefined,
): number {
  const stored = Number(storedSpeed);
  if (Number.isFinite(stored) && stored > 0 && stored !== DEFAULT_STORED_SPEED) return stored;
  return resolveRaceSpeed(race, subrace);
}
