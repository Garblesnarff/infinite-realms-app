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
export type SrdSpellcastingAbility = Extract<
  SrdAbilityName,
  'intelligence' | 'wisdom' | 'charisma'
>;
export type SrdPreparedSpellFormula =
  | 'ability-modifier-plus-level'
  | 'ability-modifier-plus-half-level';

export interface SrdSpellcastingRules {
  readonly ability: SrdSpellcastingAbility;
  readonly knownSpellsByLevel?: readonly number[];
  readonly knownSpellsFormula?: 'wizard-spellbook';
  readonly preparedSpellsFormula?: SrdPreparedSpellFormula;
  readonly firstSpellcastingLevel?: number;
}

export interface SrdSpellQuotas {
  readonly known: number;
  readonly prepared: number;
}

export interface SrdClassData {
  readonly id: string;
  readonly name: string;
  readonly hitDie: SrdHitDie;
  readonly primaryAbility: SrdAbilityName;
  readonly savingThrowProficiencies: readonly SrdAbilityName[];
  readonly spellcasting?: SrdSpellcastingRules;
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
    spellcasting: {
      ability: 'charisma',
      knownSpellsByLevel: [
        0, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 15, 16, 18, 19, 19, 20, 22, 22, 22,
      ],
    },
  },
  {
    id: 'cleric',
    name: 'Cleric',
    hitDie: 8,
    primaryAbility: 'wisdom',
    savingThrowProficiencies: ['wisdom', 'charisma'],
    spellcasting: {
      ability: 'wisdom',
      preparedSpellsFormula: 'ability-modifier-plus-level',
    },
  },
  {
    id: 'druid',
    name: 'Druid',
    hitDie: 8,
    primaryAbility: 'wisdom',
    savingThrowProficiencies: ['intelligence', 'wisdom'],
    spellcasting: {
      ability: 'wisdom',
      preparedSpellsFormula: 'ability-modifier-plus-level',
    },
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
    spellcasting: {
      ability: 'charisma',
      preparedSpellsFormula: 'ability-modifier-plus-half-level',
      firstSpellcastingLevel: 2,
    },
  },
  {
    id: 'ranger',
    name: 'Ranger',
    hitDie: 10,
    primaryAbility: 'dexterity',
    savingThrowProficiencies: ['strength', 'dexterity'],
    spellcasting: {
      ability: 'wisdom',
      knownSpellsByLevel: [0, 0, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11],
      firstSpellcastingLevel: 2,
    },
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
    spellcasting: {
      ability: 'charisma',
      knownSpellsByLevel: [
        0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 13, 13, 14, 14, 15, 15, 15, 15,
      ],
    },
  },
  {
    id: 'warlock',
    name: 'Warlock',
    hitDie: 8,
    primaryAbility: 'charisma',
    savingThrowProficiencies: ['wisdom', 'charisma'],
    spellcasting: {
      ability: 'charisma',
      knownSpellsByLevel: [
        0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15,
      ],
    },
  },
  {
    id: 'wizard',
    name: 'Wizard',
    hitDie: 6,
    primaryAbility: 'intelligence',
    savingThrowProficiencies: ['intelligence', 'wisdom'],
    spellcasting: {
      ability: 'intelligence',
      knownSpellsFormula: 'wizard-spellbook',
      preparedSpellsFormula: 'ability-modifier-plus-level',
    },
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

/** Resolve the SRD known/prepared quotas without depending on UI or display-layer calculations. */
export function getSrdSpellQuotas(
  className: string | null | undefined,
  level: number,
  abilityModifier: number,
): SrdSpellQuotas {
  const spellcasting = findSrdClass(className)?.spellcasting;
  if (!spellcasting) return { known: 0, prepared: 0 };

  const boundedLevel = Math.min(20, Math.max(1, Math.floor(level)));
  if (
    spellcasting.firstSpellcastingLevel !== undefined &&
    boundedLevel < spellcasting.firstSpellcastingLevel
  ) {
    return { known: 0, prepared: 0 };
  }

  const known =
    spellcasting.knownSpellsFormula === 'wizard-spellbook'
      ? 6 + (boundedLevel - 1) * 2
      : (spellcasting.knownSpellsByLevel?.[boundedLevel] ?? 0);
  const prepared =
    spellcasting.preparedSpellsFormula === 'ability-modifier-plus-level'
      ? Math.max(1, boundedLevel + abilityModifier)
      : spellcasting.preparedSpellsFormula === 'ability-modifier-plus-half-level'
        ? Math.max(1, Math.floor(boundedLevel / 2) + abilityModifier)
        : 0;

  return { known, prepared };
}
