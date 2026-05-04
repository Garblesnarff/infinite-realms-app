/**
 * Inventory Data Access
 *
 * Extracted from InventoryService.
 * Handles database operations for D&D 5E inventory management.
 *
 * @module server-bun/services/inventory/inventory-data-access
 */

import { eq, and, desc, or, sql, exists, inArray } from 'drizzle-orm';

import { InventoryMechanics } from './inventory-mechanics.js';
import { db } from '../../../../db/client';
import {
  inventoryItems,
  characters,
  characterStats,
  type InventoryItem,
  type NewInventoryItem,
} from '../../../../db/schema/index';
import { NotFoundError } from '../../lib/errors.js';

import type {
  CreateInventoryItemInput,
  UpdateInventoryItemInput,
  GetInventoryOptions,
  InventorySummary,
  EquipResult,
  EncumbranceStatus,
  ItemType,
} from '../../types/inventory.js';

export class InventoryDataAccess {
  /**
   * Get character inventory with optional filters
   */
  static async getInventory(
    characterId: string,
    userId: string,
    options: GetInventoryOptions = {}
  ): Promise<InventorySummary> {
    const results = await db
      .select({
        item: inventoryItems,
        characterId: characters.id,
      })
      .from(characters)
      .leftJoin(
        inventoryItems,
        and(
          eq(inventoryItems.characterId, characters.id),
          options.itemType ? eq(inventoryItems.itemType, options.itemType) : undefined,
          options.equipped !== undefined ? eq(inventoryItems.isEquipped, options.equipped) : undefined,
          options.attuned !== undefined ? eq(inventoryItems.isAttuned, options.attuned) : undefined
        )
      )
      .where(
        and(
          eq(characters.id, characterId),
          or(eq(characters.userId, userId), eq(characters.ownerId, userId))
        )
      )
      .orderBy(desc(inventoryItems.createdAt));

    if (results.length === 0) {
      throw new NotFoundError('Character', characterId);
    }

    const items = results
      .map((r) => r.item)
      .filter((item): item is InventoryItem => item !== null);

    const totalWeight = items.reduce((sum, item) => {
      const weight = parseFloat(item.weight || '0');
      return sum + weight * item.quantity;
    }, 0);

    return {
      items,
      totalWeight: Math.round(totalWeight * 100) / 100,
      totalItems: items.length,
    };
  }

  /**
   * Add item to character inventory
   */
  static async addItem(input: CreateInventoryItemInput, userId: string): Promise<InventoryItem> {
    const [item] = await db
      .insert(inventoryItems)
      .select(
        db
          .select({
            characterId: sql`${input.characterId}`,
            name: sql`${input.name}`,
            itemType: sql`${input.itemType}`,
            quantity: sql`${input.quantity ?? 1}`,
            weight: sql`${input.weight?.toString() ?? '0'}`,
            description: sql`${input.description ?? null}`,
            properties: sql`${input.properties ? JSON.stringify(input.properties) : null}`,
            isEquipped: sql`${input.isEquipped ?? false}`,
            isAttuned: sql`${input.isAttuned ?? false}`,
            requiresAttunement: sql`${input.requiresAttunement ?? false}`,
          })
          .from(characters)
          .where(
            and(
              eq(characters.id, input.characterId),
              or(eq(characters.userId, userId), eq(characters.ownerId, userId))
            )
          )
      )
      .returning();

    if (!item) {
      throw new NotFoundError('Character', input.characterId);
    }

    return item;
  }

  /**
   * Update an existing inventory item
   */
  static async updateItem(
    itemId: string,
    characterId: string,
    userId: string,
    updates: UpdateInventoryItemInput
  ): Promise<InventoryItem | null> {
    const updateData: Partial<NewInventoryItem> = {};

    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.quantity !== undefined) updateData.quantity = updates.quantity;
    if (updates.weight !== undefined) updateData.weight = updates.weight.toString();
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.properties !== undefined) {
      updateData.properties = JSON.stringify(updates.properties);
    }
    if (updates.isEquipped !== undefined) updateData.isEquipped = updates.isEquipped;
    if (updates.isAttuned !== undefined) updateData.isAttuned = updates.isAttuned;

    const [updated] = await db
      .update(inventoryItems)
      .set({
        ...updateData,
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

  /**
   * Remove item from inventory
   */
  static async removeItem(itemId: string, characterId: string, userId: string): Promise<boolean> {
    const result = await db
      .delete(inventoryItems)
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
      .returning({ id: inventoryItems.id });

    return result.length > 0;
  }

  /**
   * Get a single inventory item by ID
   */
  static async getItemById(itemId: string, characterId: string, userId: string): Promise<InventoryItem | null> {
    const [result] = await db
      .select({ item: inventoryItems })
      .from(inventoryItems)
      .innerJoin(characters, eq(inventoryItems.characterId, characters.id))
      .where(and(
        eq(inventoryItems.id, itemId),
        eq(inventoryItems.characterId, characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId))
      ))
      .limit(1);

    return result?.item || null;
  }

  /**
   * Equip weapon or armor
   */
  static async equipItem(characterId: string, itemId: string, userId: string): Promise<EquipResult> {
    const [updated] = await db
      .update(inventoryItems)
      .set({ isEquipped: true, updatedAt: new Date() })
      .where(
        and(
          eq(inventoryItems.id, itemId),
          eq(inventoryItems.characterId, characterId),
          inArray(inventoryItems.itemType, ['weapon', 'armor'] as ItemType[]),
          exists(
            db
              .select({ id: characters.id })
              .from(characters)
              .where(
                and(
                  eq(characters.id, inventoryItems.characterId),
                  or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
                ),
              ),
          ),
        ),
      )
      .returning();

    if (!updated) {
      // Diagnostic check only on failure (keeps happy path O(1))
      const [itemResult] = await db
        .select({ item: inventoryItems })
        .from(inventoryItems)
        .innerJoin(characters, eq(inventoryItems.characterId, characters.id))
        .where(and(
          eq(inventoryItems.id, itemId),
          eq(inventoryItems.characterId, characterId),
          or(eq(characters.userId, userId), eq(characters.ownerId, userId))
        ))
        .limit(1);

      const item = itemResult?.item;
      if (!item) return { success: false, error: 'Item not found' };
      if (item.itemType !== 'weapon' && item.itemType !== 'armor') {
        return { success: false, error: 'Only weapons and armor can be equipped' };
      }
      return { success: false, error: 'Failed to equip item' };
    }

    return {
      success: true,
      equippedItem: updated,
    };
  }

  /**
   * Calculate total inventory weight
   */
  static async calculateTotalWeight(characterId: string, userId: string): Promise<number> {
    const [result] = await db
      .select({
        totalWeight: sql<string>`COALESCE(SUM(${inventoryItems.weight} * ${inventoryItems.quantity}), 0)`
      })
      .from(inventoryItems)
      .innerJoin(characters, eq(inventoryItems.characterId, characters.id))
      .where(and(
        eq(inventoryItems.characterId, characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId))
      ));

    return parseFloat(result?.totalWeight || '0');
  }

  /**
   * Get carrying capacity
   */
  static async getCarryingCapacity(characterId: string, userId: string): Promise<number> {
    const statsResult = await db
      .select({ stats: characterStats })
      .from(characterStats)
      .innerJoin(characters, eq(characterStats.characterId, characters.id))
      .where(and(
        eq(characterStats.characterId, characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId))
      ))
      .limit(1);

    if (!statsResult || statsResult.length === 0) {
      throw new NotFoundError('Character stats', characterId);
    }

    const stats = statsResult[0]?.stats;
    if (!stats) {
      throw new NotFoundError('Character stats', characterId);
    }

    return InventoryMechanics.calculateCarryingCapacity(stats.strength);
  }

  /**
   * Check encumbrance status
   */
  static async checkEncumbrance(characterId: string, userId: string): Promise<EncumbranceStatus> {
    const [result] = await db
      .select({
        strength: characterStats.strength,
        totalWeight: sql<string>`COALESCE(SUM(${inventoryItems.weight} * ${inventoryItems.quantity}), 0)`
      })
      .from(characters)
      .innerJoin(characterStats, eq(characters.id, characterStats.characterId))
      .leftJoin(inventoryItems, eq(characters.id, inventoryItems.characterId))
      .where(and(
        eq(characters.id, characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId))
      ))
      .groupBy(characterStats.strength, characters.id);

    if (!result) {
      throw new NotFoundError('Character or stats', characterId);
    }

    return InventoryMechanics.calculateEncumbrance(result.strength, parseFloat(result.totalWeight));
  }
}
