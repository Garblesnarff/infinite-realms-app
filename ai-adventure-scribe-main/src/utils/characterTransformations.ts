import { findSrdClass } from '../../shared/srd-class-data';

import type { Character, AbilityScores } from '@/types/character';

/**
 * Transforms ability scores for database storage
 * Adds required fields and converts from ability score object to flat structure
 * @param abilityScores - The character's ability scores
 * @param characterId - The unique identifier of the character
 * @returns Object formatted for character_stats table
 */
export const transformAbilityScoresForStorage = (
  abilityScores: AbilityScores,
  characterId: string,
  characterClass: string | null | undefined,
) => {
  // Calculate base armor class (10 + dexterity modifier)
  const baseArmorClass = 10 + (abilityScores.dexterity.modifier || 0);

  const classData = findSrdClass(characterClass);
  if (!classData) {
    throw new Error(`Unsupported SRD class "${characterClass || ''}"; refusing HP initialization.`);
  }

  // Level-1 HP is the class hit die plus the Constitution modifier.
  const baseHitPoints = classData.hitDie + (abilityScores.constitution.modifier || 0);

  return {
    character_id: characterId,
    strength: abilityScores.strength.score,
    dexterity: abilityScores.dexterity.score,
    constitution: abilityScores.constitution.score,
    intelligence: abilityScores.intelligence.score,
    wisdom: abilityScores.wisdom.score,
    charisma: abilityScores.charisma.score,
    armor_class: baseArmorClass,
    current_hit_points: baseHitPoints,
    max_hit_points: baseHitPoints,
  };
};

/**
 * Transforms equipment data for database storage
 * @param character - The character with inventory data
 * @param characterId - The unique identifier of the character
 * @returns Array of equipment objects formatted for character_equipment table
 */
export const transformEquipmentForStorage = (character: Character, characterId: string) => {
  if (!character.inventory || character.inventory.length === 0) {
    return [];
  }

  return character.inventory.map((item) => ({
    character_id: characterId,
    // #205: the sheet loads itemName from item_name; the wizard string[] and
    // game paths carry the name in itemId with no itemName, so fall back to it
    // rather than writing a row UUID into item_name.
    item_name: item.itemName ?? item.itemId,
    item_type: item.itemType || 'equipment',
    quantity: item.quantity || 1,
    equipped: item.equipped || false,
    // Magic item properties
    is_magic: item.isMagic || false,
    magic_bonus: item.magicBonus || 0,
    magic_properties: item.magicProperties ? JSON.stringify(item.magicProperties) : null,
    requires_attunement: item.requiresAttunement || false,
    is_attuned: item.isAttuned || false,
    attunement_requirements: item.attunementRequirements || null,
    magic_item_type: item.magicItemType || null,
    magic_item_rarity: item.magicItemRarity || 'common',
    magic_effects: item.magicEffects ? JSON.stringify(item.magicEffects) : null,
  }));
};

/**
 * Transforms multiclassing data for database storage
 * @param character - The character with multiclassing data
 * @returns Object with multiclassing fields for characters table
 */
export const transformMulticlassingForStorage = (character: Character) => {
  return {
    // Multiclassing
    class_levels: character.classLevels ? JSON.stringify(character.classLevels) : null,
    total_level: character.totalLevel || character.level || 1,
  };
};

/**
 * Transforms multiclassing data from database format to character format
 * @param dbData - The database data with multiclassing fields
 * @returns Object with multiclassing fields for character object
 */
export const transformMulticlassingFromStorage = (dbData: any) => {
  return {
    // Multiclassing
    classLevels: dbData.class_levels ? JSON.parse(dbData.class_levels as string) : null,
    totalLevel: dbData.total_level || null,
  };
};
