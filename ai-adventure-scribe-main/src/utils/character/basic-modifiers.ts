/**
 * Character Basic Modifiers
 *
 * Provides basic D&D 5e modifier calculation primitives, ability mappings,
 * and proficiency checking helpers.
 * Extracted from characterModifiers.ts
 *
 * @author AI Dungeon Master Team
 */

import { abilityModifier } from '../../../shared/ability-modifier';

import type { Character } from '@/types/character';

import { calculateProficiencyBonus as calculateBasicProficiencyBonus } from '@/utils/character/basic-math';
import { canonicalProficiencyKey, hasProficiency } from '@/utils/character/parse-proficiency-list';

// D&D 5e ability names
export type AbilityName =
  | 'strength'
  | 'dexterity'
  | 'constitution'
  | 'intelligence'
  | 'wisdom'
  | 'charisma';

// D&D 5e skills and their associated abilities
export const SKILL_ABILITIES: Record<string, AbilityName> = {
  // Strength
  athletics: 'strength',

  // Dexterity
  acrobatics: 'dexterity',
  'sleight of hand': 'dexterity',
  stealth: 'dexterity',

  // Intelligence
  arcana: 'intelligence',
  history: 'intelligence',
  investigation: 'intelligence',
  nature: 'intelligence',
  religion: 'intelligence',

  // Wisdom
  'animal handling': 'wisdom',
  insight: 'wisdom',
  medicine: 'wisdom',
  perception: 'wisdom',
  survival: 'wisdom',

  // Charisma
  deception: 'charisma',
  intimidation: 'charisma',
  performance: 'charisma',
  persuasion: 'charisma',
};

// Common alternate skill names
export const SKILL_ALIASES: Record<string, string> = {
  sleight: 'sleight of hand',
  animal: 'animal handling',
  handle: 'animal handling',
};

// D&D 5e tools whose check has a fixed ability (2014 SRD 5.1). A tool check with
// one of these resolves to that ability even when the request names none.
export const TOOL_ABILITIES: Record<string, AbilityName> = {
  "thieves' tools": 'dexterity',
  'disguise kit': 'charisma',
  'forgery kit': 'dexterity',
  'herbalism kit': 'intelligence',
  "navigator's tools": 'wisdom',
};

/**
 * The ability a tool check uses, or undefined when the tool has no fixed ability.
 * Comparison is case/apostrophe/hyphen-insensitive ("Thieves' Tools" == "thieves-tools").
 */
export function getToolAbility(toolName: string): AbilityName | undefined {
  const key = canonicalProficiencyKey(toolName);
  if (!key) return undefined;
  // Gaming checks default to recalling the rules; an explicitly requested ability wins.
  if (key.startsWith('gamingset')) return 'intelligence';
  for (const [tool, ability] of Object.entries(TOOL_ABILITIES)) {
    if (canonicalProficiencyKey(tool) === key) return ability;
  }
  return undefined;
}

/**
 * Calculate proficiency bonus based on character level
 * D&D 5e proficiency bonus progression
 */
export function calculateProficiencyBonus(level: number): number {
  return calculateBasicProficiencyBonus(level);
}

/**
 * Get ability modifier from character
 */
export function getAbilityModifier(character: Character, ability: AbilityName): number {
  const abilityScore = character.abilityScores?.[ability];
  if (!abilityScore) {
    return 0;
  }

  // Use pre-calculated modifier if available, otherwise calculate
  return abilityScore.modifier ?? abilityModifier(abilityScore.score);
}

/**
 * Get proficiency bonus from character
 */
export function getProficiencyBonus(character: Character): number {
  return calculateProficiencyBonus(character.level || 1);
}

/**
 * Check if character is proficient in a skill
 */
export function isSkillProficient(character: Character, skillName: string): boolean {
  const normalizedSkill = skillName.toLowerCase();
  const actualSkill = SKILL_ALIASES[normalizedSkill] || normalizedSkill;

  // Check if skill is in character's skill proficiencies. Canonicalised on both
  // sides so `sleight_of_hand` (template seeding) matches `Sleight of Hand`
  // (creation wizard) — see #1847.
  if (character.skillProficiencies) {
    return hasProficiency(character.skillProficiencies, actualSkill);
  }

  return false;
}

/**
 * Check if character is proficient in a saving throw
 */
export function isSaveProficient(character: Character, ability: AbilityName): boolean {
  if (character.savingThrowProficiencies) {
    return character.savingThrowProficiencies.includes(ability);
  }

  // Fallback: check abilityScores savingThrow flag
  return character.abilityScores?.[ability]?.savingThrow || false;
}

export function isToolProficient(character: Character, toolName: string): boolean {
  if (hasProficiency(character.toolProficiencies, toolName)) return true;
  const key = canonicalProficiencyKey(toolName);
  if (!key.startsWith('gamingset')) return false;
  const kind = key.includes('cards') ? 'cards' : key.includes('dice') ? 'dice' : undefined;
  if (!kind || !hasProficiency(character.toolProficiencies, 'One type of gaming set')) return false;
  const ownedKinds = new Set<string>();
  for (const item of character.inventory ?? []) {
    if (item.quantity <= 0) continue;
    const name = canonicalProficiencyKey(item.itemName ?? item.itemId);
    if (['deckofcards', 'playingcards', 'gamingsetcards'].includes(name)) ownedKinds.add('cards');
    if (['diceset', 'setofdice', 'gamingsetdice'].includes(name)) ownedKinds.add('dice');
  }
  return ownedKinds.size === 1 && ownedKinds.has(kind);
}
