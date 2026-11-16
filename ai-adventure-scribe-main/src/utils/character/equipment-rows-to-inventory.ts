import type { Issue1784EquipmentRow } from '@/services/issue-1784-api';
import type { Character } from '@/types/character';

/**
 * `character_equipment` rows (the `/v1/characters/:id/equipment` response) as the game
 * character's inventory.
 *
 * `itemId` stays the item NAME. The wizard writes that back as `item_name`, and the game
 * sheet resolves weapons and armour from it. `equipmentId` is the row id. Attune posts that
 * id, not the name.
 */
export function equipmentRowsToInventory(
  rows: Issue1784EquipmentRow[],
): NonNullable<Character['inventory']> {
  return rows.map((row) => ({
    itemId: row.item_name,
    itemName: row.item_name,
    equipmentId: row.id,
    itemType: row.item_type || undefined,
    quantity: row.quantity ?? 1,
    // The rows carry no weight. Unset, the encumbrance rule counts 1 lb per unit and would take
    // speed off the sheet; the game character had no inventory (weight 0) before this.
    weight: 0,
    equipped: row.equipped || false,
    isMagic: row.is_magic || false,
    magicBonus: row.magic_bonus || 0,
    requiresAttunement: row.requires_attunement || false,
    isAttuned: row.is_attuned || false,
  }));
}
