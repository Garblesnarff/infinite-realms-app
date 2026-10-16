/**
 * #711: the equipment array the sheet PUT sends when Equip is clicked.
 *
 * The sheet loads creation rows as item_type "equipment" (the wizard never
 * sends "armor" or "weapon"). Equip flips `equipped` on that inventory and
 * persistCharacterUpdate must PUT the whole list through
 * transformEquipmentForStorage. This file is the literal transcription of
 * that transform for a Chain Mail / Shield / Longsword package. No imports:
 * client vitest and server bun:test both load it.
 */

export interface SheetEquipInventoryItem {
  itemId: string;
  itemName: string;
  itemType: string;
  quantity: number;
  equipped: boolean;
}

const ROWS: Array<Omit<SheetEquipInventoryItem, 'equipped'>> = [
  {
    itemId: '37c4f5ff-3909-4834-9668-bc2347a99004',
    itemName: 'Chain Mail',
    itemType: 'equipment',
    quantity: 1,
  },
  {
    itemId: '8f2e1a4b-6c3d-4e5f-8a7b-9c0d1e2f3a4b',
    itemName: 'Shield',
    itemType: 'equipment',
    quantity: 1,
  },
  {
    itemId: 'a1b2c3d4-e5f6-4789-8abc-def012345678',
    itemName: 'Longsword',
    itemType: 'equipment',
    quantity: 1,
  },
];

/** Sheet inventory with the named pieces worn. Names match itemName, not the row UUID. */
export function sheetEquipInventory(equippedNames: readonly string[]): SheetEquipInventoryItem[] {
  const worn = new Set(equippedNames);
  return ROWS.map((row) => ({ ...row, equipped: worn.has(row.itemName) }));
}

/** Exact `equipment` body transformEquipmentForStorage emits for sheetEquipInventory. */
export function sheetEquipWireBody(
  characterId: string,
  equippedNames: readonly string[],
): Record<string, unknown>[] {
  return sheetEquipInventory(equippedNames).map((item) => ({
    character_id: characterId,
    item_name: item.itemName,
    item_type: item.itemType || 'equipment',
    quantity: item.quantity || 1,
    equipped: item.equipped || false,
    is_magic: false,
    magic_bonus: 0,
    magic_properties: null,
    requires_attunement: false,
    is_attuned: false,
    attunement_requirements: null,
    magic_item_type: null,
    magic_item_rarity: 'common',
    magic_effects: null,
  }));
}
