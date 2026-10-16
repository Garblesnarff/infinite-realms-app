import { carryingCapacityForStrength } from '../../../shared/carrying-capacity';
import { proficiencyBonus } from '../../../shared/proficiency-bonus';
import { findSrdClass } from '../../../shared/srd-class-data';

import type { Character } from '@/types/character';

/**
 * ⚡ Bolt: Static skills map to avoid re-allocation on every calculateSkillModifiers call.
 */
export const SKILLS_MAP = {
  Acrobatics: 'dexterity',
  'Animal Handling': 'wisdom',
  Arcana: 'intelligence',
  Athletics: 'strength',
  Deception: 'charisma',
  History: 'intelligence',
  Insight: 'wisdom',
  Intimidation: 'charisma',
  Investigation: 'intelligence',
  Medicine: 'wisdom',
  Nature: 'intelligence',
  Perception: 'wisdom',
  Performance: 'charisma',
  Persuasion: 'charisma',
  Religion: 'intelligence',
  'Sleight of Hand': 'dexterity',
  Stealth: 'dexterity',
  Survival: 'wisdom',
} as const;

/**
 * Calculate proficiency bonus based on character level
 */
export const calculateProficiencyBonus = (level: number): number => {
  return proficiencyBonus(level);
};

/**
 * Calculate hit points based on class, level, and constitution
 */
export const calculateHitPoints = (character: Character): number => {
  const level = Math.max(1, character.level || 1);
  const conMod = character.abilityScores?.constitution?.modifier || 0;
  const hitDie = character.class?.hitDie ?? findSrdClass(character.class?.name)?.hitDie;

  if (hitDie === undefined) {
    throw new Error('Cannot calculate hit points without a resolved character class');
  }

  // First level gets max hit die + con mod
  // D&D 5e rule: minimum 1 HP per level
  const firstLevelHP = Math.max(1, hitDie + conMod);

  // Subsequent levels get average of hit die (rounded up) + con mod
  const perSubsequentLevelHP = Math.max(1, Math.floor(hitDie / 2) + 1 + conMod);
  const subsequentLevelsHP = (level - 1) * perSubsequentLevelHP;

  // D&D 5e rule: minimum 1 HP per level TOTAL (level * 1)
  // Current implementation does Math.max(1, ...) for each level's contribution, which effectively ensures this.
  return firstLevelHP + subsequentLevelsHP;
};

export const calculateCarryingCapacity = (character: Character): number =>
  carryingCapacityForStrength(character.abilityScores?.strength?.score || 10);
