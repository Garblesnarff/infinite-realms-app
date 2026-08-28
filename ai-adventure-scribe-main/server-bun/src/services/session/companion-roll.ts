import { ValidationError } from '../../lib/errors.js';
import {
  canonicalProficiencyKey,
  hasProficiency,
  parseProficiencyList,
} from '../../lib/parse-proficiency-list.js';

export type CompanionRollKind = 'skill' | 'ability' | 'save';

export type AbilityName =
  | 'strength'
  | 'dexterity'
  | 'constitution'
  | 'intelligence'
  | 'wisdom'
  | 'charisma';

export const SKILL_ABILITIES: Record<string, AbilityName> = {
  athletics: 'strength',
  acrobatics: 'dexterity',
  sleightofhand: 'dexterity',
  stealth: 'dexterity',
  arcana: 'intelligence',
  history: 'intelligence',
  investigation: 'intelligence',
  nature: 'intelligence',
  religion: 'intelligence',
  animalhandling: 'wisdom',
  insight: 'wisdom',
  medicine: 'wisdom',
  perception: 'wisdom',
  survival: 'wisdom',
  deception: 'charisma',
  intimidation: 'charisma',
  performance: 'charisma',
  persuasion: 'charisma',
};

const SKILL_ALIASES: Record<string, string> = {
  sleight: 'sleightofhand',
  animal: 'animalhandling',
  handle: 'animalhandling',
};

const ABILITY_NAMES: Record<string, AbilityName> = {
  strength: 'strength',
  str: 'strength',
  dexterity: 'dexterity',
  dex: 'dexterity',
  constitution: 'constitution',
  con: 'constitution',
  intelligence: 'intelligence',
  int: 'intelligence',
  wisdom: 'wisdom',
  wis: 'wisdom',
  charisma: 'charisma',
  cha: 'charisma',
};

export interface StoredRollStats {
  strength: number | null;
  dexterity: number | null;
  constitution: number | null;
  intelligence: number | null;
  wisdom: number | null;
  charisma: number | null;
}

export interface StoredRollCharacter {
  level: number | null;
  skillProficiencies: unknown;
  expertiseProficiencies: unknown;
  savingThrowProficiencies: unknown;
}

export interface RollModifierResult {
  ability: AbilityName;
  abilityModifier: number;
  proficiencyBonus: number;
  modifier: number;
  isProficient: boolean;
  breakdown: string[];
}

const abilityShortName = (ability: AbilityName): string => ability.slice(0, 3).toUpperCase();

function resolveAbility(name: string): AbilityName {
  const ability = ABILITY_NAMES[canonicalProficiencyKey(name)];
  if (!ability) throw new ValidationError(`Unknown ability: ${name}`);
  return ability;
}

function resolveSkill(name: string): { key: string; ability: AbilityName } {
  const canonical = canonicalProficiencyKey(name);
  const key = SKILL_ALIASES[canonical] ?? canonical;
  const ability = SKILL_ABILITIES[key];
  if (!ability) throw new ValidationError(`Unknown skill: ${name}`);
  return { key, ability };
}

function storedAbilityModifier(stats: StoredRollStats | null, ability: AbilityName): number {
  if (!stats) throw new ValidationError('Character has no stored ability scores');
  const score = stats[ability];
  if (typeof score !== 'number' || !Number.isFinite(score)) {
    throw new ValidationError(`Character has no stored ${ability} score`);
  }
  return Math.floor((score - 10) / 2);
}

function storedProficiencyBonus(level: number | null): number {
  if (typeof level !== 'number' || !Number.isFinite(level)) {
    throw new ValidationError('Character has no stored level');
  }
  return 2 + Math.floor((Math.max(1, level) - 1) / 4);
}

function signed(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}

/**
 * Calculate a companion's modifier from persisted character columns only.
 *
 * This mirrors the #1878 skill/save rules: ability scores come from
 * `character_stats`, proficiency and expertise come from the persisted CSV
 * columns, and expertise doubles proficiency only when the character is also
 * proficient in that skill.
 */
export function calculateCompanionRollModifier(
  kind: CompanionRollKind,
  name: string,
  character: StoredRollCharacter,
  stats: StoredRollStats | null,
): RollModifierResult {
  const proficiencyBonus = storedProficiencyBonus(character.level);
  let ability: AbilityName;
  let proficient = false;
  let effectiveProficiency = 0;

  if (kind === 'skill') {
    const skill = resolveSkill(name);
    ability = skill.ability;
    const skills = parseProficiencyList(character.skillProficiencies);
    proficient = hasProficiency(skills, skill.key);
    const expertise = hasProficiency(
      parseProficiencyList(character.expertiseProficiencies),
      skill.key,
    );
    effectiveProficiency = proficient ? proficiencyBonus * (expertise ? 2 : 1) : 0;
  } else {
    ability = resolveAbility(name);
    if (kind === 'save') {
      proficient = hasProficiency(
        parseProficiencyList(character.savingThrowProficiencies),
        ability,
      );
      effectiveProficiency = proficient ? proficiencyBonus : 0;
    }
  }

  const abilityModifier = storedAbilityModifier(stats, ability);
  const modifier = abilityModifier + effectiveProficiency;
  const breakdown = [
    '1d20',
    `${abilityShortName(ability)} ${signed(abilityModifier)}`,
    ...(effectiveProficiency > 0 ? [`Prof ${signed(effectiveProficiency)}`] : []),
  ];

  return {
    ability,
    abilityModifier,
    proficiencyBonus: effectiveProficiency,
    modifier,
    isProficient: proficient,
    breakdown,
  };
}
