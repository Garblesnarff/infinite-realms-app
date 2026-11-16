/**
 * Attunement (DMG p. 136, max 3). Sheet gear lives on character_equipment.
 * The sheet posts that row id, or an inventory_items id. A name still matches.
 * One completed short rest with empty notes is spent on the item. This service
 * claims a rest the rest route already recorded. It does not heal.
 */

import { and, desc, eq, gte, isNotNull, isNull, or } from 'drizzle-orm';

import { attunedNameCount, ownedBy, siblingName, tokenMatch } from './attunement-token.js';
import { db } from '../../../../db/client';
import {
  inventoryItems,
  characterEquipment,
  characters,
  restEvents,
} from '../../../../db/schema/index';
import { MAX_ATTUNED_ITEMS } from '../../types/inventory.js';

import type { AttunedRecord, AttunementResult } from '../../types/inventory.js';

type AttunableTable = typeof characterEquipment | typeof inventoryItems;

type AttunableItem = {
  id: string;
  requiresAttunement: boolean | null;
  isAttuned: boolean | null;
  createdAt: Date | null;
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

/** A transaction handle from `db.transaction`. */
type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

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

    const itemCreatedAt = (item as AttunableItem).createdAt ?? null;

    let updated: AttunedRecord | undefined;
    try {
      await db.transaction(async (tx) => {
        const claimed = await this.claimShortRest(characterId, item.id, itemCreatedAt, tx);
        if (!claimed) {
          throw new Error('__no_rest__');
        }
        const result = await this.setAttuned(table, item.id, characterId, userId, true, false, tx);
        if (!result) {
          throw new Error('__update_failed__');
        }
        updated = result;
      });
    } catch (error) {
      if (error instanceof Error && error.message === '__no_rest__') {
        return refuse(attunedCount, 'Attunement needs a short rest spent on this item');
      }
      if (error instanceof Error && error.message === '__update_failed__') {
        return refuse(attunedCount, 'Failed to attune to item');
      }
      throw error;
    }

    if (!updated) {
      return refuse(attunedCount, 'Failed to attune to item');
    }

    return {
      success: true,
      attunedItem: updated as AttunedRecord,
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

  private static async claimShortRest(
    characterId: string,
    itemId: string,
    itemCreatedAt: Date | null,
    executor: DbTx = db as any,
  ): Promise<boolean> {
    const conditions = [
      eq(restEvents.characterId, characterId),
      eq(restEvents.restType, 'short'),
      eq(restEvents.interrupted, false),
      isNotNull(restEvents.completedAt),
      isNull(restEvents.notes),
    ];
    if (itemCreatedAt) {
      conditions.push(gte(restEvents.completedAt, itemCreatedAt));
    }

    const [rest] = await executor
      .select({ id: restEvents.id, completedAt: restEvents.completedAt, notes: restEvents.notes })
      .from(restEvents)
      .where(and(...conditions))
      .orderBy(desc(restEvents.completedAt))
      .limit(1);
    if (!rest) return false;

    const [claimed] = await executor
      .update(restEvents)
      .set({ notes: `attunement:${itemId}`, updatedAt: new Date() })
      .where(and(eq(restEvents.id, rest.id), isNull(restEvents.notes)))
      .returning({ id: restEvents.id });
    return Boolean(claimed);
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
    executor: DbTx = db as any,
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
    const [updated] = await executor
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
