/**
 * #205: the exact equipment wire body the character sheet sends on save.
 *
 * Shared on purpose (AGENTS.md §4, pattern #2286): the client test asserts
 * `transformEquipmentForStorage` emits exactly this for a sheet-loaded
 * character, and the real-DB test PUTs this same body through the real route.
 * Two inline copies would drift — the #2250/#2280 failure mode, where a body
 * the tests approved 422'd in production.
 *
 * No imports: this file is loaded by both the client vitest suite (which uses
 * the `@/` alias) and the server bun:test suite (which does not), so it must
 * stay dependency-free like the other fixtures here.
 */

/** Sheet-loaded inventory: itemId is the character_equipment row UUID, itemName the display name. */
export interface EquipmentSheetInventoryItem {
  itemId: string;
  itemName: string;
  itemType?: string;
  quantity: number;
  equipped: boolean;
}

/**
 * The inventory `transformCharacterData` produces for two equipment rows —
 * the same producer the character sheet loads through.
 */
export const EQUIPMENT_SHEET_INVENTORY: EquipmentSheetInventoryItem[] = [
  {
    itemId: '37c4f5ff-3909-4834-9668-bc2347a99004',
    itemName: 'Chain Mail',
    itemType: 'armor',
    quantity: 1,
    equipped: true,
  },
  {
    itemId: '8f2e1a4b-6c3d-4e5f-8a7b-9c0d1e2f3a4b',
    itemName: 'Longsword',
    itemType: 'weapon',
    quantity: 1,
    equipped: true,
  },
];

/**
 * The exact array `transformEquipmentForStorage` emits for
 * EQUIPMENT_SHEET_INVENTORY — the `equipment` body the client PUTs to
 * `/v1/characters/:id`. A literal transcription of the transform's output, so
 * any change to what the client sends fails the client test loudly.
 */
export const equipmentSaveWireBody = (characterId: string): Record<string, unknown>[] =>
  EQUIPMENT_SHEET_INVENTORY.map((item) => ({
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
