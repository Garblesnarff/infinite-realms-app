/**
 * Attunement (DMG p. 136, max 3).
 *
 * character_equipment is the source of truth. The token is that row's id
 * (the sheet) or the item name (the game loader). inventory_items is only
 * the fallback for a story grant that has no sheet row yet.
 */

import { eq, and, or } from 'drizzle-orm';

import { attunedNameCount, ownedBy, siblingName, tokenMatch } from './attunement-token.js';
import { db } from '../../../../db/client';
import { inventoryItems, characterEquipment, characters } from '../../../../db/schema/index';
import { MAX_ATTUNED_ITEMS } from '../../types/inventory.js';

import type { AttunedRecord, AttunementResult } from '../../types/inventory.js';

type AttunableTable = typeof characterEquipment | typeof inventoryItems;

type AttunableItem = {
  id: string;
  requiresAttunement: boolean | null;
  isAttuned: boolean | null;
};

function columns(table: AttunableTable) {
  return table === characterEquipment
    ? {
        id: characterEquipment.id,
        name: characterEquipment.itemName,
        characterId: characterEquipment.characterId,
      }
    : {
        id: inventoryItems.id,
        name: inventoryItems.name,
        characterId: inventoryItems.characterId,
      };
}

function refuse(currentAttunedCount: number, error: string): AttunementResult {
  return { success: false, currentAttunedCount, maxAttunedCount: MAX_ATTUNED_ITEMS, error };
}

export class InventoryAttunementService {
  /** Sheet attunements. Story-only grants stay off this list until Part B. */
  static async getAttunedItems(characterId: string, userId: string): Promise<AttunedRecord[]> {
    const results = await db
      .select({ item: characterEquipment })
      .from(characterEquipment)
      .innerJoin(characters, eq(characterEquipment.characterId, characters.id))
      .where(
        and(
          eq(characterEquipment.characterId, characterId),
          or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
          eq(characterEquipment.isAttuned, true),
        ),
      );

    return results.map((row) => row.item);
  }

  static async attuneItem(
    characterId: string,
    itemId: string,
    userId: string,
  ): Promise<AttunementResult> {
    const equipment = columns(characterEquipment);
    const inventory = columns(inventoryItems);
    const hit =
      (await this.findOwnedItem(characterEquipment, equipment, characterId, itemId, userId)) ??
      (await this.findOwnedItem(inventoryItems, inventory, characterId, itemId, userId));

    if (!hit) return refuse(0, 'Item not found');

    const { item, attunedCount, table } = hit;
    if (!item.requiresAttunement) return refuse(attunedCount, 'Item does not require attunement');
    if (item.isAttuned) return refuse(attunedCount, 'Item is already attuned');
    if (attunedCount >= MAX_ATTUNED_ITEMS) {
      return refuse(
        attunedCount,
        `Cannot attune to more than ${MAX_ATTUNED_ITEMS} items. Unattune from another item first.`,
      );
    }

    const updated = await this.setAttuned(table, item.id, characterId, userId, true);
    if (!updated) return refuse(attunedCount, 'Failed to attune to item');

    return {
      success: true,
      attunedItem: updated,
      currentAttunedCount: attunedCount + 1,
      maxAttunedCount: MAX_ATTUNED_ITEMS,
    };
  }

  static async unattuneItem(
    itemId: string,
    characterId: string,
    userId: string,
  ): Promise<AttunedRecord | null> {
    const equipment = await this.setAttuned(
      characterEquipment,
      itemId,
      characterId,
      userId,
      false,
      true,
    );
    const inventory = await this.setAttuned(
      inventoryItems,
      itemId,
      characterId,
      userId,
      false,
      true,
    );
    return equipment ?? inventory ?? null;
  }

  private static async findOwnedItem(
    table: AttunableTable,
    column: ReturnType<typeof columns>,
    characterId: string,
    token: string,
    userId: string,
  ): Promise<{ item: AttunableItem; attunedCount: number; table: AttunableTable } | undefined> {
    const results = await db
      .select({ item: table, attunedCount: attunedNameCount(characterId) })
      .from(table)
      .innerJoin(characters, eq(column.characterId, characters.id))
      .where(
        and(
          tokenMatch(column.id, column.name, token),
          eq(column.characterId, characterId),
          or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
        ),
      )
      .limit(1);

    const result = results[0];
    if (!result) return undefined;
    return {
      item: result.item as AttunableItem,
      attunedCount: Number(result.attunedCount ?? 0),
      table,
    };
  }

  private static async setAttuned(
    table: AttunableTable,
    itemId: string,
    characterId: string,
    userId: string,
    isAttuned: boolean,
    matchToken = false,
  ): Promise<AttunedRecord | undefined> {
    const column = columns(table);
    const other = columns(table === characterEquipment ? inventoryItems : characterEquipment);
    const direct = tokenMatch(column.id, column.name, itemId);
    const across = siblingName(
      column.name,
      table === characterEquipment ? inventoryItems : characterEquipment,
      other.id,
      other.name,
      other.characterId,
      characterId,
      itemId,
    );
    const identity = matchToken ? (or(direct, across) ?? direct) : eq(column.id, itemId);
    const [updated] = await db
      .update(table)
      .set({ isAttuned, updatedAt: new Date() })
      .where(
        and(
          identity,
          eq(column.characterId, characterId),
          ownedBy(userId, column.characterId),
          isAttuned ? undefined : eq(table.isAttuned, true),
        ),
      )
      .returning({ id: column.id, isAttuned: table.isAttuned });

    return updated;
  }
}
