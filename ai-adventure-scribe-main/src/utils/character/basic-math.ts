import type { Character } from '@/types/character';

import { EQUIPMENT_LOOKUP } from '@/data/equipmentOptions';

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
  return Math.floor((level - 1) / 4) + 2;
};

/**
 * Calculate hit points based on class, level, and constitution
 */
export const calculateHitPoints = (character: Character): number => {
  const level = Math.max(1, character.level || 1);
  const conMod = character.abilityScores?.constitution?.modifier || 0;
  const hitDie = character.class?.hitDie || 8;

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

/**
 * Calculate armor class (basic calculation, can be enhanced for different armor types)
 */
export const calculateArmorClass = (character: Character): number => {
  const dexMod = character.abilityScores?.dexterity?.modifier || 0;
  const equippedArmor = character.equippedArmor
    ? EQUIPMENT_LOOKUP.get(character.equippedArmor)
    : null;
  const equippedShield = character.equippedShield
    ? EQUIPMENT_LOOKUP.get(character.equippedShield)
    : null;

  const shieldBonus = equippedShield?.armorClass?.base || (character.equippedShield ? 2 : 0);
  const isUnarmored = !equippedArmor;

  // Check if character has unarmored defense feature
  const hasUnarmoredDefense =
    isUnarmored &&
    character.class &&
    (character.class.name.toLowerCase() === 'barbarian' ||
      character.class.name.toLowerCase() === 'monk');

  // If character has unarmored defense, calculate accordingly
  if (hasUnarmoredDefense && character.class && character.abilityScores) {
    const baseAC = 10;

    switch (character.class.name.toLowerCase()) {
      case 'barbarian': {
        const conMod = character.abilityScores.constitution?.modifier || 0;
        return baseAC + dexMod + conMod + shieldBonus;
      }
      case 'monk': {
        // Monk unarmored defense does NOT work with a shield
        if (!equippedShield && !character.equippedShield) {
          const wisMod = character.abilityScores.wisdom?.modifier || 0;
          return baseAC + dexMod + wisMod;
        }
        break;
      }
    }
  }

  // Armor Calculation
  let baseAC = 10;
  let effectiveDexMod = dexMod;

  if (equippedArmor && equippedArmor.armorClass) {
    baseAC = equippedArmor.armorClass.base;
    if (equippedArmor.armorClass.dexModifier === false) {
      effectiveDexMod = 0;
    } else if (equippedArmor.armorClass.maxDexModifier !== undefined) {
      effectiveDexMod = Math.min(dexMod, equippedArmor.armorClass.maxDexModifier);
    }
  }

  return baseAC + effectiveDexMod + shieldBonus;
};

/**
 * Calculate carrying capacity
 */
export const calculateCarryingCapacity = (character: Character): number => {
  return (character.abilityScores?.strength?.score || 10) * 15;
};
