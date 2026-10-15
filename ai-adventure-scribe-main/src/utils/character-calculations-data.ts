import { SRD_CLASS_TABLE } from '../../shared/srd-class-data';

import type { AbilityScores } from '@/types/character';

/**
 * ⚡ Bolt: Static map of spellcasting abilities for each class.
 * Moved outside to avoid redundant re-allocation on every call.
 */
export const SPELLCASTING_ABILITY_MAP: Record<string, keyof AbilityScores> = {
  Wizard: 'intelligence',
  Sorcerer: 'charisma',
  Warlock: 'charisma',
  Bard: 'charisma',
  Cleric: 'wisdom',
  Druid: 'wisdom',
  Paladin: 'charisma',
  Ranger: 'wisdom',
  'Eldritch Knight': 'intelligence',
  'Arcane Trickster': 'intelligence',
};

/**
 * ⚡ Bolt: Static maps of skill proficiencies for each class.
 * Moved outside to avoid redundant re-allocation on every call.
 */
export const CLASS_SKILL_PROFICIENCIES_MAP: Record<string, readonly string[]> = {
  Fighter: [
    'Acrobatics',
    'Animal Handling',
    'Athletics',
    'History',
    'Insight',
    'Intimidation',
    'Perception',
    'Survival',
  ],
  Wizard: ['Arcana', 'History', 'Insight', 'Investigation', 'Medicine', 'Religion'],
  Rogue: [
    'Acrobatics',
    'Athletics',
    'Deception',
    'Insight',
    'Intimidation',
    'Investigation',
    'Perception',
    'Performance',
    'Persuasion',
    'Sleight of Hand',
    'Stealth',
  ],
  Cleric: ['History', 'Insight', 'Medicine', 'Persuasion', 'Religion'],
} as const;

/**
 * ⚡ Bolt: Static maps of skill proficiencies for races and subraces.
 * Moved outside to avoid redundant re-allocation on every call.
 */
export const RACE_SKILL_PROFICIENCIES_MAP: Record<string, readonly string[]> = {
  'Half-Elf': ['Deception', 'Persuasion'],
  'Human (Variant)': ['Insight'],
} as const;

export const SUBRACE_SKILL_PROFICIENCIES_MAP: Record<string, readonly string[]> = {
  'Wood Elf': ['Stealth'],
  'Lightfoot Halfling': ['Stealth'],
} as const;

/**
 * Saving throw fallback for each SRD class.
 *
 * Fallback only — used when a character has no persisted
 * `savingThrowProficiencies`, which is the case for every template-derived
 * character, since starter seeding never writes that column.
 *
 * The source table lives in `shared/srd-class-data.ts` so scripts and server-side repairs can
 * reuse the same SRD values. `src/utils/__tests__/class-saving-throw-map.test.ts` also keeps the
 * table aligned with the richer frontend class records.
 */
export const CLASS_SAVING_THROW_PROFICIENCIES_MAP: Record<string, readonly string[]> =
  Object.fromEntries(
    SRD_CLASS_TABLE.map(({ name, savingThrowProficiencies }) => [name, savingThrowProficiencies]),
  );
