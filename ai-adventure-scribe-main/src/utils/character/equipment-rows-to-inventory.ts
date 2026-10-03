import type { Issue1784EquipmentRow } from '@/services/issue-1784-api';
import type { Character } from '@/types/character';

/**
 * `character_equipment` rows (the `/v1/characters/:id/equipment` response) as the game
 * character's inventory.
 *
 * `itemId` is the item NAME, not the row id: that is what the character wizard puts there and
 * what `transformEquipmentForStorage` writes back as `item_name`, and the game sheet resolves
 * weapons and armour from it. Only the fields the game sheet reads are carried.
 */
export function equipmentRowsToInventory(
  rows: Issue1784EquipmentRow[],
): NonNullable<Character['inventory']> {
  return rows.map((row) => ({
    itemId: row.item_name,
    itemType: row.item_type || undefined,
    quantity: row.quantity || 1,
    // The rows carry no weight. Unset, the encumbrance rule counts 1 lb per unit and would take
    // speed off the sheet; the game character had no inventory (weight 0) before this.
    weight: 0,
    equipped: row.equipped || false,
    isMagic: row.is_magic || false,
    magicBonus: row.magic_bonus || 0,
  }));
}
