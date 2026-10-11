/**
 * Weapon proficiency, defined once for the whole game (#2540, #2541).
 *
 * Two places asked the same question and answered it differently. The combat engine
 * (`server-bun/src/services/combat/data-access.ts` `characterCanUseWeapon`) read the class name
 * and the weapon catalog; the character sheet (`src/utils/character/weapon-attack-bonus.ts`
 * `isProficient`) read the class name plus whatever proficiency lists the character record
 * carries. So a High Elf Wizard with a longsword showed +proficiency on the sheet while the attack
 * dialog rolled without it, and a Wizard with a mace got +proficiency the SRD does not grant —
 * both from the same character and the same weapon.
 *
 * The rule is the 2014 rules / SRD 5.1 class lists, read strictly: a class either takes a category
 * grant ("simple weapons", "simple and martial weapons") or a named list, never "every simple
 * weapon for everyone". On top of that, every proficiency the character record itself carries
 * counts — the class list when the record has one, the subrace list (High Elf weapon training) and
 * the racial list (Dwarf weapon training).
 *
 * Dependencies are the SRD weapon catalog and `shared/srd-class-data.ts` only, so the browser
 * bundle, the Bun server and a repair script can all read the same answer. `tests/
 * weapon-proficiency.test.ts` pins the class table against `src/data/classes`.
 */

import { findSrdClass } from './srd-class-data';
import weaponCatalog from '../src/data/srd/weapons.json';

type CatalogWeapon = {
  id: string;
  name: string;
  weaponType?: 'simple' | 'martial';
  subcategory?: string;
};

const CATALOG = weaponCatalog as CatalogWeapon[];

// ====================================
// Names a proficiency list may use
// ====================================

/** Lower-case, letters and digits only, so "Crossbow, light" and "crossbow_light" are one key. */
const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * The key one proficiency entry is stored under. Lists are written in the plural
 * ("Daggers", "Longswords", "Light crossbows") and the catalog in the singular, so the plural is
 * folded away. A word that already ends in "ss" is not a plural.
 */
function entryKey(value: string): string {
  const key = normalize(value);
  return key.endsWith('s') && !key.endsWith('ss') ? key.slice(0, -1) : key;
}

const SIMPLE_WEAPONS_KEY = entryKey('Simple weapons');
const MARTIAL_WEAPONS_KEY = entryKey('Martial weapons');

/**
 * Every entry key that names this catalog weapon.
 *
 * SRD display names are "Noun, adjective" ("Crossbow, light") while the lists that grant
 * proficiency say it the other way round ("Light crossbows"), so the name is indexed both ways
 * round. The two category grants are deliberately NOT indexed here: `coversWeapon` matches them
 * against the weapon's category, so a category entry can never resolve to one particular weapon.
 */
function catalogEntryKeys(weapon: CatalogWeapon): string[] {
  const keys = [normalize(weapon.id), normalize(weapon.name)];
  const words = weapon.name.split(/[^a-z0-9]+/i).filter(Boolean);
  if (words.length > 1) {
    // "Crossbow, light" is written "Light crossbow" by the SRD weapon tables and by the lists
    // that grant proficiency, so both orders of the words are indexed.
    keys.push(normalize(words.join('')), normalize([...words].reverse().join('')));
  }
  return keys.map(entryKey);
}

// ====================================
// The catalog, indexed by the keys above
// ====================================

/** entry key -> normalized SRD weapon id. */
const WEAPON_ID_BY_ENTRY_KEY = new Map<string, string>();
/** normalized SRD weapon id -> 'simple' | 'martial'. */
const WEAPON_TYPE_BY_ID = new Map<string, 'simple' | 'martial'>();

for (const weapon of CATALOG) {
  WEAPON_TYPE_BY_ID.set(normalize(weapon.id), weapon.weaponType ?? 'simple');
  for (const key of catalogEntryKeys(weapon)) WEAPON_ID_BY_ENTRY_KEY.set(key, normalize(weapon.id));
}

// ====================================
// SRD 5.1 weapon proficiencies
// ====================================

/**
 * The class lists, keyed by SRD class id, in the same vocabulary the client class records use.
 *
 * Wizard and Sorcerer take named lists rather than a category grant, so a Wizard is not
 * proficient with a mace (SRD p. 112), and Druid's list is the SRD's (#2541). Every class whose
 * record says "simple weapons" or "simple and martial weapons" keeps exactly that category grant.
 */
export const SRD_CLASS_WEAPON_PROFICIENCIES: Record<string, readonly string[]> = {
  barbarian: ['Simple weapons', 'Martial weapons'],
  bard: ['Simple weapons', 'Hand crossbows', 'Longswords', 'Rapiers', 'Shortswords'],
  cleric: ['Simple weapons'],
  druid: [
    'Clubs',
    'Daggers',
    'Darts',
    'Javelins',
    'Maces',
    'Quarterstaffs',
    'Scimitars',
    'Sickles',
    'Slings',
    'Spears',
  ],
  fighter: ['Simple weapons', 'Martial weapons'],
  monk: ['Simple weapons', 'Shortswords'],
  paladin: ['Simple weapons', 'Martial weapons'],
  ranger: ['Simple weapons', 'Martial weapons'],
  rogue: ['Simple weapons', 'Hand crossbows', 'Longswords', 'Rapiers', 'Shortswords'],
  sorcerer: ['Daggers', 'Darts', 'Slings', 'Quarterstaffs', 'Light crossbows'],
  warlock: ['Simple weapons'],
  wizard: ['Daggers', 'Darts', 'Slings', 'Quarterstaffs', 'Light crossbows'],
};

/**
 * Racial and subrace weapon training, keyed by normalized name.
 *
 * Exactly what the character records say, and nothing more: `src/data/races/elf.ts` gives Weapon
 * Training to the High Elf alone (no other elf subrace carries it) and `src/data/races/dwarf.ts`
 * gives the dwarves theirs racially, with Mountain Dwarf's extra being armor training. A subrace
 * that is not listed here grants nothing.
 */
const SRD_RACE_WEAPON_TRAINING: Record<string, readonly string[]> = {
  dwarf: ['Battleaxes', 'Handaxes', 'Light hammers', 'Warhammers'],
};

const SRD_SUBRACE_WEAPON_TRAINING: Record<string, readonly string[]> = {
  highelf: ['Longswords', 'Shortswords', 'Shortbows', 'Longbows'],
};

// ====================================
// The one question both callers ask
// ====================================

/**
 * Everything about a character that decides weapon proficiency. Both callers build this from the
 * data they already hold, so neither needs the other's record shape.
 */
export interface WeaponProficiencySubject {
  /** The class as the record spells it, by display name or SRD id ('Wizard', 'wizard'). */
  className?: string | null;
  raceName?: string | null;
  subraceName?: string | null;
  /**
   * Proficiency lists the record carries verbatim — the class list when the record has one, the
   * subrace list, the racial list. A game-session character often has only a class name, which is
   * why the SRD table above is the floor and these are additions.
   */
  carriedProficiencies?: readonly string[];
}

/** The class grant plus anything the record adds: what this character actually has. */
function proficienciesFor(subject: WeaponProficiencySubject): string[] {
  const classId = findSrdClass(subject.className)?.id ?? '';
  const raceTraining = SRD_RACE_WEAPON_TRAINING[normalize(subject.raceName ?? '')];
  const subraceTraining = SRD_SUBRACE_WEAPON_TRAINING[normalize(subject.subraceName ?? '')];
  return [
    ...(SRD_CLASS_WEAPON_PROFICIENCIES[classId] ?? []),
    ...(raceTraining ?? []),
    ...(subraceTraining ?? []),
    ...(subject.carriedProficiencies ?? []),
  ];
}

function coversWeapon(entry: string, weaponId: string, weaponType: string): boolean {
  const key = entryKey(entry);
  if (key === SIMPLE_WEAPONS_KEY) return weaponType === 'simple';
  if (key === MARTIAL_WEAPONS_KEY) return weaponType === 'martial';
  return WEAPON_ID_BY_ENTRY_KEY.get(key) === weaponId;
}

/**
 * True when this character is proficient with this weapon.
 *
 * `weaponId` is the SRD catalog id ('mace', 'crossbow-light'), the one both the engine's catalog
 * and the client's equipment resolver hand back. A weapon the SRD catalog does not know is never
 * a class grant, which is the fallback both callers already applied to their own lookups.
 */
export function isWeaponProficient(weaponId: string, subject: WeaponProficiencySubject): boolean {
  const key = normalize(weaponId);
  const weaponType = WEAPON_TYPE_BY_ID.get(key);
  if (!weaponType) return false;
  return proficienciesFor(subject).some((entry) => coversWeapon(entry, key, weaponType));
}

/**
 * True when this character is proficient with any of these weapons.
 *
 * Magic weapons whose own text grants proficiency by alternate weapon (Sun Blade,
 * 2014 DMG: "proficient with shortswords or longswords") carry the alternates on
 * the item row next to baseWeaponId; proficiency holds if any of them does.
 */
export function isWeaponProficientWithAny(
  weaponIds: readonly string[],
  subject: WeaponProficiencySubject,
): boolean {
  return weaponIds.some((weaponId) => isWeaponProficient(weaponId, subject));
}
