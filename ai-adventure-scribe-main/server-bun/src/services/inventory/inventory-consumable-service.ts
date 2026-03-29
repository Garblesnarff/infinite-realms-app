/**
 * Inventory Consumable Service
 *
 * Handles logic for using consumables and ammunition.
 * Extracted from InventoryService.
 *
 * @module server/services/inventory/inventory-consumable-service
 */

import { eq, and, desc, or, sql, exists } from 'drizzle-orm';

import { db } from '../../../../db/client';
import {
  inventoryItems,
  consumableUsageLog,
  characters,
  type InventoryItem,
  type ConsumableUsageLog,
} from '../../../../db/schema/index';
import { NotFoundError, BusinessLogicError, InternalServerError } from '../../lib/errors.js';
import type {
  UseConsumableInput,
  UseConsumableResult,
  GetUsageHistoryInput,
  ItemType,
} from '../../types/inventory.js';

export class InventoryConsumableService {
  /**
   * Use consumable or ammunition
   * Decrements quantity and logs usage
   */
  static async useConsumable(
    input: UseConsumableInput,
    userId: string,
    preFetchedItem?: InventoryItem
  ): Promise<UseConsumableResult> {
    // Get item if not pre-fetched
    let item = preFetchedItem;
    if (!item) {
      const [result] = await db
        .select({ item: inventoryItems })
        .from(inventoryItems)
        .innerJoin(characters, eq(inventoryItems.characterId, characters.id))
        .where(and(
          eq(inventoryItems.id, input.itemId),
          eq(inventoryItems.characterId, input.characterId),
          or(eq(characters.userId, userId), eq(characters.ownerId, userId))
        ))
        .limit(1);
      item = result?.item || undefined;
    }

    if (!item) {
      throw new NotFoundError('Inventory item', input.itemId);
    }

    const quantityToUse = input.quantity ?? 1;

    if (item.quantity < quantityToUse) {
      throw new BusinessLogicError(
        `Insufficient quantity. Available: ${item.quantity}, Requested: ${quantityToUse}`,
        { available: item.quantity, requested: quantityToUse, itemId: input.itemId }
      );
    }

    // 🛡️ Sentinel: Incorporate ownership check into the INSERT query using SELECT for defense-in-depth.
    const [usageLog] = await db
      .insert(consumableUsageLog)
      .select(
        db
          .select({
            characterId: sql`${input.characterId}`,
            itemId: sql`${input.itemId}`,
            quantityUsed: sql`${quantityToUse}`,
            sessionId: sql`${input.sessionId ?? null}`,
            context: sql`${input.context ?? null}`,
          })
          .from(inventoryItems)
          .innerJoin(characters, eq(inventoryItems.characterId, characters.id))
          .where(
            and(
              eq(inventoryItems.id, input.itemId),
              eq(inventoryItems.characterId, input.characterId),
              or(eq(characters.userId, userId), eq(characters.ownerId, userId))
            )
          )
      )
      .returning();

    if (!usageLog) {
      throw new InternalServerError('Failed to log consumable usage');
    }

    const newQuantity = item.quantity - quantityToUse;
    let itemDeleted = false;

    // Update or delete item based on remaining quantity
    if (newQuantity <= 0) {
      await db
        .delete(inventoryItems)
        .where(and(
          eq(inventoryItems.id, input.itemId),
          eq(inventoryItems.characterId, input.characterId),
          exists(
            db.select()
              .from(characters)
              .where(and(
                eq(characters.id, inventoryItems.characterId),
                or(eq(characters.userId, userId), eq(characters.ownerId, userId))
              ))
          )
        ));
      itemDeleted = true;
    } else {
      await db
        .update(inventoryItems)
        .set({
          quantity: newQuantity,
          updatedAt: new Date(),
        })
        .where(and(
          eq(inventoryItems.id, input.itemId),
          eq(inventoryItems.characterId, input.characterId),
          exists(
            db.select()
              .from(characters)
              .where(and(
                eq(characters.id, inventoryItems.characterId),
                or(eq(characters.userId, userId), eq(characters.ownerId, userId))
              ))
          )
        ));
    }

    return {
      success: true,
      remainingQuantity: Math.max(0, newQuantity),
      itemDeleted,
      usageLog,
    };
  }

  /**
   * Use ammunition (convenience method for ranged attacks)
   */
  static async useAmmunition(
    characterId: string,
    userId: string,
    ammoType: string,
    count: number = 1
  ): Promise<UseConsumableResult> {
    // Find ammunition by name
    const results = await db
      .select({ item: inventoryItems })
      .from(inventoryItems)
      .innerJoin(characters, eq(inventoryItems.characterId, characters.id))
      .where(and(
        eq(inventoryItems.characterId, characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
        eq(inventoryItems.itemType, 'ammunition'),
        eq(inventoryItems.name, ammoType)
      ));

    if (results.length === 0) {
      throw new NotFoundError(`Ammunition "${ammoType}"`, characterId);
    }

    const item = results[0]?.item;
    if (!item) {
      throw new NotFoundError(`Ammunition "${ammoType}"`, characterId);
    }

    return this.useConsumable({
      characterId,
      itemId: item.id,
      quantity: count,
      context: 'Ranged attack',
    }, userId, item);
  }

  /**
   * Recover ammunition after combat
   */
  static async recoverAmmunition(
    characterId: string,
    userId: string,
    ammoType: string,
    count: number
  ): Promise<InventoryItem> {
    // Find or create ammunition
    const results = await db
      .select({ item: inventoryItems })
      .from(inventoryItems)
      .innerJoin(characters, eq(inventoryItems.characterId, characters.id))
      .where(and(
        eq(inventoryItems.characterId, characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
        eq(inventoryItems.itemType, 'ammunition'),
        eq(inventoryItems.name, ammoType)
      ));

    if (results.length > 0) {
      // Add to existing
      const item = results[0]?.item;
      if (!item) {
        throw new InternalServerError('Failed to find ammunition item');
      }

      const [updated] = await db
        .update(inventoryItems)
        .set({
          quantity: item.quantity + count,
          updatedAt: new Date(),
        })
        .where(and(
          eq(inventoryItems.id, item.id),
          eq(inventoryItems.characterId, characterId),
          exists(
            db.select()
              .from(characters)
              .where(and(
                eq(characters.id, inventoryItems.characterId),
                or(eq(characters.userId, userId), eq(characters.ownerId, userId))
              ))
          )
        ))
        .returning();

      if (!updated) throw new InternalServerError('Failed to update ammunition');
      return updated;
    } else {
      // Create new ammunition entry
      const [item] = await db
        .insert(inventoryItems)
        .select(
          db
            .select({
              characterId: sql`${characterId}`,
              name: sql`${ammoType}`,
              itemType: sql`'ammunition'::"item_type"`,
              quantity: sql`${count}`,
              weight: sql`'0.05'`,
              description: sql`NULL`,
              properties: sql`NULL`,
              isEquipped: sql`false`,
              isAttuned: sql`false`,
              requiresAttunement: sql`false`,
            })
            .from(characters)
            .where(
              and(
                eq(characters.id, characterId),
                or(eq(characters.userId, userId), eq(characters.ownerId, userId))
              )
            )
        )
        .returning();

      if (!item) {
        throw new NotFoundError('Character', characterId);
      }

      return item;
    }
  }

  /**
   * Get consumable usage history
   */
  static async getUsageHistory(input: GetUsageHistoryInput, userId: string): Promise<ConsumableUsageLog[]> {
    const results = await db
      .select({ log: consumableUsageLog })
      .from(consumableUsageLog)
      .innerJoin(characters, eq(consumableUsageLog.characterId, characters.id))
      .where(and(
        eq(consumableUsageLog.characterId, input.characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
        input.itemId ? eq(consumableUsageLog.itemId, input.itemId) : undefined,
        input.sessionId ? eq(consumableUsageLog.sessionId, input.sessionId) : undefined
      ))
      .orderBy(desc(consumableUsageLog.timestamp))
      .limit(input.limit ?? 100);

    return results.map(r => r.log);
  }
}
