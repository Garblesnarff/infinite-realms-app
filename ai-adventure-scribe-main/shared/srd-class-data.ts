/**
 * The 2014 SRD class values that are needed outside the frontend's richer class definitions.
 *
 * Keep this dependency-free so browser code, Bun scripts, and the server can all use the same
 * table. The full class records in `src/data/classes` add descriptions, features, and equipment;
 * this table is the small rules contract that repair scripts and calculations need.
 */

export const SRD_ABILITY_NAMES = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
] as const;

export type SrdAbilityName = (typeof SRD_ABILITY_NAMES)[number];
export type SrdHitDie = 6 | 8 | 10 | 12;

export interface SrdClassData {
  readonly id: string;
  readonly name: string;
  readonly hitDie: SrdHitDie;
  readonly primaryAbility: SrdAbilityName;
  readonly savingThrowProficiencies: readonly SrdAbilityName[];
}

export const SRD_CLASS_TABLE = [
  {
    id: 'barbarian',
    name: 'Barbarian',
    hitDie: 12,
    primaryAbility: 'strength',
    savingThrowProficiencies: ['strength', 'constitution'],
  },
  {
    id: 'bard',
    name: 'Bard',
    hitDie: 8,
    primaryAbility: 'charisma',
    savingThrowProficiencies: ['dexterity', 'charisma'],
  },
  {
    id: 'cleric',
    name: 'Cleric',
    hitDie: 8,
    primaryAbility: 'wisdom',
    savingThrowProficiencies: ['wisdom', 'charisma'],
  },
  {
    id: 'druid',
    name: 'Druid',
    hitDie: 8,
    primaryAbility: 'wisdom',
    savingThrowProficiencies: ['intelligence', 'wisdom'],
  },
  {
    id: 'fighter',
    name: 'Fighter',
    hitDie: 10,
    primaryAbility: 'strength',
    savingThrowProficiencies: ['strength', 'constitution'],
  },
  {
    id: 'monk',
    name: 'Monk',
    hitDie: 8,
    primaryAbility: 'dexterity',
    savingThrowProficiencies: ['strength', 'dexterity'],
  },
  {
    id: 'paladin',
    name: 'Paladin',
    hitDie: 10,
    primaryAbility: 'strength',
    savingThrowProficiencies: ['wisdom', 'charisma'],
  },
  {
    id: 'ranger',
    name: 'Ranger',
    hitDie: 10,
    primaryAbility: 'dexterity',
    savingThrowProficiencies: ['strength', 'dexterity'],
  },
  {
    id: 'rogue',
    name: 'Rogue',
    hitDie: 8,
    primaryAbility: 'dexterity',
    savingThrowProficiencies: ['dexterity', 'intelligence'],
  },
  {
    id: 'sorcerer',
    name: 'Sorcerer',
    hitDie: 6,
    primaryAbility: 'charisma',
    savingThrowProficiencies: ['constitution', 'charisma'],
  },
  {
    id: 'warlock',
    name: 'Warlock',
    hitDie: 8,
    primaryAbility: 'charisma',
    savingThrowProficiencies: ['wisdom', 'charisma'],
  },
  {
    id: 'wizard',
    name: 'Wizard',
    hitDie: 6,
    primaryAbility: 'intelligence',
    savingThrowProficiencies: ['intelligence', 'wisdom'],
  },
] as const satisfies readonly SrdClassData[];

function normalizeClassKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Resolve an SRD class by either its stable id or display name. */
export function findSrdClass(value: string | null | undefined): SrdClassData | undefined {
  const key = normalizeClassKey(value || '');
  if (!key) return undefined;

  return SRD_CLASS_TABLE.find(
    (entry) => normalizeClassKey(entry.id) === key || normalizeClassKey(entry.name) === key,
  );
}
