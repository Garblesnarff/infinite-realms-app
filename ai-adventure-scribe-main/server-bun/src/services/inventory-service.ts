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
 * @module server-bun/services/inventory-service
 */

import { InventoryAttunementService } from './inventory/inventory-attunement-service.js';
import { InventoryConsumableService } from './inventory/inventory-consumable-service.js';
import { InventoryDataAccess } from './inventory/inventory-data-access.js';
import { type InventoryItem, type ConsumableUsageLog } from '../../../db/schema/index';

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
    return InventoryDataAccess.getInventory(characterId, userId, options);
  }

  /**
   * Add item to character inventory
   * @param input - Item creation data
   * @param userId - User ID (for ownership verification)
   * @returns Created inventory item
   */
  static async addItem(input: CreateInventoryItemInput, userId: string): Promise<InventoryItem> {
    return InventoryDataAccess.addItem(input, userId);
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
    return InventoryDataAccess.updateItem(itemId, characterId, userId, updates);
  }

  /**
   * Remove item from inventory
   * @param itemId - Item ID to delete
   * @param characterId - Character ID (for ownership verification)
   * @param userId - User ID (for ownership verification)
   * @returns True if deleted, false if not found
   */
  static async removeItem(itemId: string, characterId: string, userId: string): Promise<boolean> {
    return InventoryDataAccess.removeItem(itemId, characterId, userId);
  }

  /**
   * Get a single inventory item by ID
   * @param itemId - Item ID
   * @param characterId - Character ID (for ownership verification)
   * @param userId - User ID (for ownership verification)
   * @returns Item or null if not found
   */
  static async getItemById(itemId: string, characterId: string, userId: string): Promise<InventoryItem | null> {
    return InventoryDataAccess.getItemById(itemId, characterId, userId);
  }

  // ==========================================
  // Consumable & Ammunition Usage
  // ==========================================

  /**
   * Use consumable or ammunition
   * @deprecated Use InventoryConsumableService.useConsumable directly
   */
  static async useConsumable(
    input: UseConsumableInput,
    userId: string,
    preFetchedItem?: InventoryItem
  ): Promise<UseConsumableResult> {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- server-side class method, not a React hook
    return InventoryConsumableService.useConsumable(input, userId, preFetchedItem);
  }

  /**
   * Use ammunition (convenience method for ranged attacks)
   * @deprecated Use InventoryConsumableService.useAmmunition directly
   */
  static async useAmmunition(
    characterId: string,
    userId: string,
    ammoType: string,
    count: number = 1
  ): Promise<UseConsumableResult> {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- server-side class method, not a React hook
    return InventoryConsumableService.useAmmunition(characterId, userId, ammoType, count);
  }

  /**
   * Recover ammunition after combat
   * @deprecated Use InventoryConsumableService.recoverAmmunition directly
   */
  static async recoverAmmunition(
    characterId: string,
    userId: string,
    ammoType: string,
    count: number
  ): Promise<InventoryItem> {
    return InventoryConsumableService.recoverAmmunition(characterId, userId, ammoType, count);
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
    // ⚡ Bolt: Delegation wrapper maintains compatibility with tests that spy on InventoryService.
    const result = await InventoryDataAccess.equipItem(characterId, itemId, userId);

    if (!result.success) {
      // Diagnostic check only on failure (keeps happy path O(1))
      // Some tests spy on this.getItemById or this.getItemById directly, so we keep the diagnostic logic here
      // to ensure tests that mock getItemById can still influence the error message.
      const item = await this.getItemById(itemId, characterId, userId);
      if (!item) return { success: false, error: 'Item not found' };
      if (item.itemType !== 'weapon' && item.itemType !== 'armor') {
        return { success: false, error: 'Only weapons and armor can be equipped' };
      }
      return { success: false, error: 'Failed to equip item' };
    }

    return result;
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
    return InventoryDataAccess.calculateTotalWeight(characterId, userId);
  }

  /**
   * Get carrying capacity
   * Carrying capacity = Strength × 15 lbs (PHB pg. 176)
   * @param characterId - Character ID
   * @param userId - User ID (for ownership verification)
   * @returns Carrying capacity in pounds
   */
  static async getCarryingCapacity(characterId: string, userId: string): Promise<number> {
    return InventoryDataAccess.getCarryingCapacity(characterId, userId);
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
    return InventoryDataAccess.checkEncumbrance(characterId, userId);
  }

  // ==========================================
  // Attunement Tracking (DMG pg. 136)
  // ==========================================

  /**
   * Get all attuned items for a character
   * @deprecated Use InventoryAttunementService.getAttunedItems directly
   */
  static async getAttunedItems(characterId: string, userId: string): Promise<InventoryItem[]> {
    return InventoryAttunementService.getAttunedItems(characterId, userId);
  }

  /**
   * Attune to a magic item
   * @deprecated Use InventoryAttunementService.attuneItem directly
   */
  static async attuneItem(
    characterId: string,
    itemId: string,
    userId: string,
  ): Promise<AttunementResult> {
    return InventoryAttunementService.attuneItem(characterId, itemId, userId);
  }

  /**
   * Break attunement with a magic item
   * @deprecated Use InventoryAttunementService.unattuneItem directly
   */
  static async unattuneItem(itemId: string, characterId: string, userId: string): Promise<InventoryItem | null> {
    return InventoryAttunementService.unattuneItem(itemId, characterId, userId);
  }

  // ==========================================
  // Usage History
  // ==========================================

  /**
   * Get consumable usage history
   * @deprecated Use InventoryConsumableService.getUsageHistory directly
   */
  static async getUsageHistory(input: GetUsageHistoryInput, userId: string): Promise<ConsumableUsageLog[]> {
    return InventoryConsumableService.getUsageHistory(input, userId);
  }
}
