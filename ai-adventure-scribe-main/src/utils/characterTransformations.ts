import type { Character, AbilityScores } from '@/types/character';

/**
 * Transforms ability scores for database storage
 * Converts from ability score object to flat structure. HP and armour class
 * are NOT computed here (#620): the server is the only place that derives
 * them, from the class, the scores and the equipment the client sends.
 * @param abilityScores - The character's ability scores
 * @param characterId - The unique identifier of the character
 * @returns Object formatted for character_stats table
 */
export const transformAbilityScoresForStorage = (
  abilityScores: AbilityScores,
  characterId: string,
) => {
  return {
    character_id: characterId,
    strength: abilityScores.strength.score,
    dexterity: abilityScores.dexterity.score,
    constitution: abilityScores.constitution.score,
    intelligence: abilityScores.intelligence.score,
    wisdom: abilityScores.wisdom.score,
    charisma: abilityScores.charisma.score,
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
