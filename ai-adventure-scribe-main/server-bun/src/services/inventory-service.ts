/* eslint-disable max-lines */
/**
 * Inventory Service
 *
 * Handles D&D 5E inventory management including:
 * - Item tracking (weapons, armor, consumables, ammunition, equipment, treasure)
 * - Ammunition and consumable usage
 * - Weight and encumbrance calculations (PHB pg. 176)
 * - Attunement tracking (DMG pg. 136, max 3 items)
 * - Equipment management
 *
 * @module server/services/inventory-service
 */

import { eq, and, desc, or, sql, exists } from 'drizzle-orm';

import { db } from '../../../db/client.js';
import {
  inventoryItems,
  consumableUsageLog,
  characterStats,
  characters,
  type InventoryItem,
  type NewInventoryItem,
  type ConsumableUsageLog,
} from '../../../db/schema/index.js';
import { NotFoundError, BusinessLogicError, InternalServerError } from '../lib/errors.js';
import {
  MAX_ATTUNED_ITEMS,
  ENCUMBRANCE_THRESHOLDS,
  SPEED_PENALTIES,
} from '../types/inventory.js';

import type {
  CreateInventoryItemInput,
  UpdateInventoryItemInput,
  UseConsumableInput,
  UseConsumableResult,
  EncumbranceStatus,
  InventorySummary,
  AttunementResult,
  EquipResult,
  GetInventoryOptions,
  GetUsageHistoryInput,
  EncumbranceLevel,
} from '../types/inventory.js';


export class InventoryService {
  // ==========================================
  // Inventory Management
  // ==========================================

  /**
   * Get character inventory with optional filters
   * @param characterId - Character ID
   * @param userId - User ID (for ownership verification)
   * @param options - Filter options (itemType, equipped, attuned)
   * @returns Inventory summary with items and total weight
   */
  static async getInventory(
    characterId: string,
    userId: string,
    options: GetInventoryOptions = {}
  ): Promise<InventorySummary> {
    // ⚡ Bolt: Consolidated character existence/ownership check and item retrieval into a single query.
    // Using a LEFT JOIN from characters ensures we can distinguish between "Character not found" (0 rows)
    // and "Character found but no items" (1 row with null item).
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

    // Filter out null items (from characters with no matching inventory items)
    const items = results
      .map((r) => r.item)
      .filter((item): item is InventoryItem => item !== null);

    const totalWeight = items.reduce((sum, item) => {
      const weight = parseFloat(item.weight || '0');
      return sum + weight * item.quantity;
    }, 0);

    return {
      items,
      totalWeight: Math.round(totalWeight * 100) / 100, // Round to 2 decimal places
      totalItems: items.length,
    };
  }

  /**
   * Add item to character inventory
   * @param input - Item creation data
   * @param userId - User ID (for ownership verification)
   * @returns Created inventory item
   */
  static async addItem(input: CreateInventoryItemInput, userId: string): Promise<InventoryItem> {
    // 🛡️ Sentinel: Incorporate ownership check into the INSERT query using SELECT for defense-in-depth.
    // This ensures that items can only be added to characters the user is authorized to access.
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
   * @param itemId - Item ID to update
   * @param characterId - Character ID (for ownership verification)
   * @param userId - User ID (for ownership verification)
   * @param updates - Fields to update
   * @returns Updated item or null if not found
   */
  static async updateItem(
    itemId: string,
    characterId: string,
    userId: string,
    updates: UpdateInventoryItemInput
  ): Promise<InventoryItem | null> {
    // ⚡ Bolt: Optimized to perform ownership check in a single UPDATE query instead of 1 Select + 1 Update.
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
   * @param itemId - Item ID to delete
   * @param characterId - Character ID (for ownership verification)
   * @param userId - User ID (for ownership verification)
   * @returns True if deleted, false if not found
   */
  static async removeItem(itemId: string, characterId: string, userId: string): Promise<boolean> {
    // ⚡ Bolt: Optimized to perform ownership check in a single DELETE query instead of 1 Select + 1 Delete.
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
   * @param itemId - Item ID
   * @param characterId - Character ID (for ownership verification)
   * @param userId - User ID (for ownership verification)
   * @returns Item or null if not found
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

  // ==========================================
  // Consumable & Ammunition Usage
  // ==========================================

  /**
   * Use consumable or ammunition
   * Decrements quantity and logs usage
   * @param input - Usage input data
   * @param userId - User ID (for ownership verification)
   * @param preFetchedItem - Optional pre-fetched item to avoid redundant DB call
   * @returns Usage result with remaining quantity
   */
  static async useConsumable(
    input: UseConsumableInput,
    userId: string,
    preFetchedItem?: InventoryItem
  ): Promise<UseConsumableResult> {
    // ⚡ Bolt: Use pre-fetched item if available to avoid redundant database lookup.
    const item = preFetchedItem || await this.getItemById(input.itemId, input.characterId, userId);

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
    // This ensures that usage logs can only be created for items and characters the user is authorized to access.
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
    // ⚡ Bolt: Calls to optimized removeItem/updateItem now perform atomic ownership checks.
    if (newQuantity <= 0) {
      await this.removeItem(input.itemId, input.characterId, userId);
      itemDeleted = true;
    } else {
      await this.updateItem(input.itemId, input.characterId, userId, { quantity: newQuantity });
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
   * @param characterId - Character ID
   * @param userId - User ID (for ownership verification)
   * @param ammoType - Ammunition type/name
   * @param count - Number to use (default 1)
   * @returns Usage result
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

    // ⚡ Bolt: Pass pre-fetched ammunition item to useConsumable to avoid redundant DB lookup.
    return this.useConsumable({
      characterId,
      itemId: item.id,
      quantity: count,
      context: 'Ranged attack',
    }, userId, item);
  }

  /**
   * Recover ammunition after combat
   * @param characterId - Character ID
   * @param userId - User ID (for ownership verification)
   * @param ammoType - Ammunition type/name
   * @param count - Number to recover
   * @returns Updated item
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
      const updated = await this.updateItem(item.id, characterId, userId, {
        quantity: item.quantity + count,
      });
      if (!updated) throw new InternalServerError('Failed to update ammunition');
      return updated;
    } else {
      // Create new ammunition entry
      return this.addItem({
        characterId,
        name: ammoType,
        itemType: 'ammunition',
        quantity: count,
        weight: 0.05, // Default weight per arrow/bolt
      }, userId);
    }
  }

  // ==========================================
  // Equipment Management
  // ==========================================

  /**
   * Equip weapon or armor
   * @param characterId - Character ID
   * @param itemId - Item ID to equip
   * @param userId - User ID (for ownership verification)
   * @returns Equip result
   */
  static async equipItem(characterId: string, itemId: string, userId: string): Promise<EquipResult> {
    const item = await this.getItemById(itemId, characterId, userId);

    if (!item) {
      return { success: false, error: 'Item not found' };
    }

    if (item.itemType !== 'weapon' && item.itemType !== 'armor') {
      return { success: false, error: 'Only weapons and armor can be equipped' };
    }

    const updated = await this.updateItem(itemId, characterId, userId, { isEquipped: true });

    if (!updated) {
      return { success: false, error: 'Failed to equip item' };
    }

    return {
      success: true,
      equippedItem: updated,
    };
  }

  /**
   * Unequip item
   * @param itemId - Item ID to unequip
   * @param characterId - Character ID (for ownership verification)
   * @param userId - User ID (for ownership verification)
   * @returns Updated item
   */
  static async unequipItem(itemId: string, characterId: string, userId: string): Promise<InventoryItem | null> {
    return this.updateItem(itemId, characterId, userId, { isEquipped: false });
  }

  // ==========================================
  // Weight & Encumbrance (PHB pg. 176)
  // ==========================================

  /**
   * Calculate total inventory weight
   * @param characterId - Character ID
   * @param userId - User ID (for ownership verification)
   * @returns Total weight in pounds
   */
  static async calculateTotalWeight(characterId: string, userId: string): Promise<number> {
    // ⚡ Bolt: Optimized to use SQL aggregation (SUM) instead of fetching all items into memory.
    // This reduces data transfer and memory usage, especially for characters with large inventories.
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
   * Carrying capacity = Strength × 15 lbs (PHB pg. 176)
   * @param characterId - Character ID
   * @param userId - User ID (for ownership verification)
   * @returns Carrying capacity in pounds
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

    // Base carrying capacity is STR × 15
    // Could be modified by size (Tiny = ×0.5, Small/Medium = ×1, Large = ×2, etc.)
    return stats.strength * 15;
  }

  /**
   * Check encumbrance status
   * Variant rule (PHB pg. 176):
   * - Normal: weight ≤ capacity
   * - Encumbered: weight > capacity × 5, speed -10
   * - Heavily Encumbered: weight > capacity × 10, speed -20, disadvantage on physical checks
   * @param characterId - Character ID
   * @param userId - User ID (for ownership verification)
   * @returns Encumbrance status
   */
  static async checkEncumbrance(characterId: string, userId: string): Promise<EncumbranceStatus> {
    // ⚡ Bolt: Optimized to use a single query with multiple joins and aggregation.
    // This replaces a 3-query pattern (stats, then weight, then stats again) with O(1) database round-trip.
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
      // If result is empty, it means either the character or their stats don't exist
      throw new NotFoundError('Character or stats', characterId);
    }

    const strength = result.strength;
    const currentWeight = parseFloat(result.totalWeight);
    const carryingCapacity = strength * 15;

    // Determine encumbrance level using variant rule
    let encumbranceLevel: EncumbranceLevel = 'normal';
    let speedPenalty = SPEED_PENALTIES.NORMAL as number;

    // Heavily Encumbered: weight > STR × 10
    if (currentWeight > strength * ENCUMBRANCE_THRESHOLDS.HEAVILY_ENCUMBERED) {
      encumbranceLevel = 'heavily_encumbered';
      speedPenalty = SPEED_PENALTIES.HEAVILY_ENCUMBERED as number;
    }
    // Encumbered: weight > STR × 5
    else if (currentWeight > strength * ENCUMBRANCE_THRESHOLDS.ENCUMBERED) {
      encumbranceLevel = 'encumbered';
      speedPenalty = SPEED_PENALTIES.ENCUMBERED as number;
    }

    return {
      currentWeight: Math.round(currentWeight * 100) / 100,
      carryingCapacity,
      encumbranceLevel,
      isEncumbered: encumbranceLevel === 'encumbered' || encumbranceLevel === 'heavily_encumbered',
      isHeavilyEncumbered: encumbranceLevel === 'heavily_encumbered',
      speedPenalty,
      strengthScore: strength,
    };
  }

  // ==========================================
  // Attunement Tracking (DMG pg. 136)
  // ==========================================

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
  static async attuneItem(characterId: string, itemId: string, userId: string): Promise<AttunementResult> {
    const item = await this.getItemById(itemId, characterId, userId);

    if (!item) {
      return {
        success: false,
        currentAttunedCount: 0,
        maxAttunedCount: MAX_ATTUNED_ITEMS,
        error: 'Item not found',
      };
    }

    if (!item.requiresAttunement) {
      return {
        success: false,
        currentAttunedCount: 0,
        maxAttunedCount: MAX_ATTUNED_ITEMS,
        error: 'Item does not require attunement',
      };
    }

    if (item.isAttuned) {
      return {
        success: false,
        currentAttunedCount: 0,
        maxAttunedCount: MAX_ATTUNED_ITEMS,
        error: 'Item is already attuned',
      };
    }

    // Check current attuned count
    const attunedItems = await this.getAttunedItems(characterId, userId);

    if (attunedItems.length >= MAX_ATTUNED_ITEMS) {
      return {
        success: false,
        currentAttunedCount: attunedItems.length,
        maxAttunedCount: MAX_ATTUNED_ITEMS,
        error: `Cannot attune to more than ${MAX_ATTUNED_ITEMS} items. Unattune from another item first.`,
      };
    }

    // Attune to the item
    const updated = await this.updateItem(itemId, characterId, userId, { isAttuned: true });

    if (!updated) {
      return {
        success: false,
        currentAttunedCount: attunedItems.length,
        maxAttunedCount: MAX_ATTUNED_ITEMS,
        error: 'Failed to attune to item',
      };
    }

    return {
      success: true,
      attunedItem: updated,
      currentAttunedCount: attunedItems.length + 1,
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
  static async unattuneItem(itemId: string, characterId: string, userId: string): Promise<InventoryItem | null> {
    return this.updateItem(itemId, characterId, userId, { isAttuned: false });
  }

  // ==========================================
  // Usage History
  // ==========================================

  /**
   * Get consumable usage history
   * @param input - Query parameters
   * @param userId - User ID (for ownership verification)
   * @returns Array of usage log entries
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
