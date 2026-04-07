/**
 * Inventory Attunement Service
 *
 * Handles logic for D&D 5E magic item attunement.
 * Maximum 3 items can be attuned at once (DMG pg. 136).
 * Extracted from InventoryService.
 *
 * @module server-bun/services/inventory/inventory-attunement-service
 */

import { eq, and, or, sql, exists } from 'drizzle-orm';

import { db } from '../../../../db/client';
import {
  inventoryItems,
  characters,
  type InventoryItem,
} from '../../../../db/schema/index';
import {
  MAX_ATTUNED_ITEMS,
} from '../../types/inventory.js';

import type {
  AttunementResult,
} from '../../types/inventory.js';

export class InventoryAttunementService {
  /**
   * Get all attuned items for a character
   * @param characterId - Character ID
   * @param userId - User ID (for ownership verification)
   * @returns Array of attuned items
   */
  static async getAttunedItems(characterId: string, userId: string): Promise<InventoryItem[]> {
    const results = await db
      .select({ item: inventoryItems })
      .from(inventoryItems)
      .innerJoin(characters, eq(inventoryItems.characterId, characters.id))
      .where(and(
        eq(inventoryItems.characterId, characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
        eq(inventoryItems.isAttuned, true)
      ));

    return results.map(r => r.item);
  }

  /**
   * Attune to a magic item
   * Maximum 3 items can be attuned at once (DMG pg. 136)
   * @param characterId - Character ID
   * @param itemId - Item ID to attune
   * @param userId - User ID (for ownership verification)
   * @returns Attunement result
   */
  static async attuneItem(
    characterId: string,
    itemId: string,
    userId: string,
  ): Promise<AttunementResult> {
    // ⚡ Bolt: Consolidated item fetch and attuned count check into a single query.
    const results = await db
      .select({
        item: inventoryItems,
        attunedCount: sql<number>`(
          SELECT count(*)::int
          FROM ${inventoryItems}
          WHERE ${inventoryItems.characterId} = ${characterId} AND ${inventoryItems.isAttuned} = true
        )`,
      })
      .from(inventoryItems)
      .innerJoin(characters, eq(inventoryItems.characterId, characters.id))
      .where(
        and(
          eq(inventoryItems.id, itemId),
          eq(inventoryItems.characterId, characterId),
          or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
        ),
      )
      .limit(1);

    const result = results[0];

    if (!result) {
      return {
        success: false,
        currentAttunedCount: 0,
        maxAttunedCount: MAX_ATTUNED_ITEMS,
        error: 'Item not found',
      };
    }

    const { item, attunedCount } = result;

    if (!item.requiresAttunement) {
      return {
        success: false,
        currentAttunedCount: attunedCount,
        maxAttunedCount: MAX_ATTUNED_ITEMS,
        error: 'Item does not require attunement',
      };
    }

    if (item.isAttuned) {
      return {
        success: false,
        currentAttunedCount: attunedCount,
        maxAttunedCount: MAX_ATTUNED_ITEMS,
        error: 'Item is already attuned',
      };
    }

    if (attunedCount >= MAX_ATTUNED_ITEMS) {
      return {
        success: false,
        currentAttunedCount: attunedCount,
        maxAttunedCount: MAX_ATTUNED_ITEMS,
        error: `Cannot attune to more than ${MAX_ATTUNED_ITEMS} items. Unattune from another item first.`,
      };
    }

    // Attune to the item (Atomic update with ownership check)
    const [updated] = await db
      .update(inventoryItems)
      .set({
        isAttuned: true,
        updatedAt: new Date(),
      })
      .where(and(
        eq(inventoryItems.id, itemId),
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

    if (!updated) {
      return {
        success: false,
        currentAttunedCount: attunedCount,
        maxAttunedCount: MAX_ATTUNED_ITEMS,
        error: 'Failed to attune to item',
      };
    }

    return {
      success: true,
      attunedItem: updated,
      currentAttunedCount: attunedCount + 1,
      maxAttunedCount: MAX_ATTUNED_ITEMS,
    };
  }

  /**
   * Break attunement with a magic item
   * @param itemId - Item ID to unattune
   * @param characterId - Character ID (for ownership verification)
   * @param userId - User ID (for ownership verification)
   * @returns Updated item or null
   */
  static async unattuneItem(
    itemId: string,
    characterId: string,
    userId: string
  ): Promise<InventoryItem | null> {
    const [updated] = await db
      .update(inventoryItems)
      .set({
        isAttuned: false,
        updatedAt: new Date(),
      })
      .where(and(
        eq(inventoryItems.id, itemId),
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

    return updated || null;
  }
}
