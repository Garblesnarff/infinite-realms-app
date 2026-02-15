/**
 * Inventory Routes (Elysia/Bun)
 *
 * REST endpoints for D&D 5E inventory management:
 * - Item CRUD operations
 * - Consumable and ammunition usage
 * - Equipment management
 * - Weight and encumbrance tracking
 * - Attunement management
 *
 * Ported from /server/src/routes/v1/inventory.ts
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { Elysia } from 'elysia';

import { verifySessionOwnership } from './combat/helpers.js';
import { authenticateRequest } from '../../lib/auth.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
// Import service from Bun server
import { InventoryService } from '../../services/inventory-service.js';

import type {
  CreateInventoryItemInput,
  UpdateInventoryItemInput,
  UseConsumableInput,
  GetInventoryOptions,
  ItemType,
} from '../../types/inventory.js';

function mapInventoryError(
  set: any,
  error: unknown,
  fallbackMessage: string,
  notFoundMessage: string = 'Not found'
): { error: string } {
  if (error instanceof AppError) {
    if (error.statusCode === 404) {
      set.status = 404;
      return { error: notFoundMessage };
    }

    set.status = error.statusCode;
    if (error.statusCode >= 500) {
      return { error: fallbackMessage };
    }

    return { error: error.message };
  }

  set.status = 500;
  return { error: fallbackMessage };
}

export const inventoryRoutes = new Elysia({ prefix: '/v1/characters' })
  /**
   * Centralized authentication and character ownership verification
   */
  .derive(async ({ request }) => {
    const { user, error: authError } = await authenticateRequest(request);
    return { user, authError };
  })
  .onBeforeHandle(async ({ user, authError, set }) => {
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    // ⚡ Bolt: Removed redundant CharacterService.getById call.
    // InventoryService methods already perform atomic ownership verification and existence masking.
  })

  // ==========================================
  // Inventory Management (4 endpoints)
  // ==========================================

  /**
   * GET /v1/characters/:id/inventory
   * Get character inventory with optional filters
   */
  .get('/:id/inventory', async ({ params, query, set, user }) => {
    try {
      const options: GetInventoryOptions = {};

      if (query.itemType && typeof query.itemType === 'string') {
        options.itemType = query.itemType as ItemType;
      }
      if (query.equipped !== undefined) {
        options.equipped = query.equipped === 'true';
      }

      const inventory = await InventoryService.getInventory(params.id, (user as any).userId, options);
      return inventory;
    } catch (error) {
      logger.error({ msg: 'INVENTORY_GET error', error });
      return mapInventoryError(set, error, 'Failed to fetch inventory', 'Character not found');
    }
  })

  /**
   * POST /v1/characters/:id/inventory
   * Add item to character inventory
   */
  .post('/:id/inventory', async ({ params, body, set, user }) => {
    try {
      const itemData = body as CreateInventoryItemInput;

      if (!itemData.name || !itemData.itemType) {
        set.status = 400;
        return { error: 'Missing required fields: name and itemType' };
      }

      const input: CreateInventoryItemInput = {
        characterId: params.id,
        name: itemData.name,
        itemType: itemData.itemType,
        quantity: itemData.quantity,
        weight: itemData.weight,
        description: itemData.description,
        properties: itemData.properties,
        isEquipped: itemData.isEquipped,
        isAttuned: itemData.isAttuned,
        requiresAttunement: itemData.requiresAttunement,
      };

      const item = await InventoryService.addItem(input, (user as any).userId);

      set.status = 201;
      return { item };
    } catch (error) {
      logger.error({ msg: 'INVENTORY_ADD error', error });
      return mapInventoryError(set, error, 'Failed to add item', 'Character not found');
    }
  })

  /**
   * PATCH /v1/characters/:id/inventory/:itemId
   * Update inventory item
   */
  .patch('/:id/inventory/:itemId', async ({ params, body, set, user }) => {
    try {
      const updates = body as UpdateInventoryItemInput;
      const input: UpdateInventoryItemInput = {};

      if (updates.name !== undefined) input.name = updates.name;
      if (updates.quantity !== undefined) input.quantity = updates.quantity;
      if (updates.weight !== undefined) input.weight = updates.weight;
      if (updates.description !== undefined) input.description = updates.description;
      if (updates.properties !== undefined) input.properties = updates.properties;
      if (updates.isEquipped !== undefined) input.isEquipped = updates.isEquipped;
      if (updates.isAttuned !== undefined) input.isAttuned = updates.isAttuned;

      const item = await InventoryService.updateItem(params.itemId, params.id, (user as any).userId, input);

      if (!item) {
        set.status = 404;
        return { error: 'Item not found' };
      }

      return { item };
    } catch (error) {
      logger.error({ msg: 'INVENTORY_UPDATE error', error });
      return mapInventoryError(set, error, 'Failed to update item', 'Item not found');
    }
  })

  /**
   * DELETE /v1/characters/:id/inventory/:itemId
   * Remove item from inventory
   */
  .delete('/:id/inventory/:itemId', async ({ params, set, user }) => {
    try {
      const deleted = await InventoryService.removeItem(params.itemId, params.id, (user as any).userId);

      if (!deleted) {
        set.status = 404;
        return { error: 'Item not found' };
      }

      return { deleted: true };
    } catch (error) {
      logger.error({ msg: 'INVENTORY_DELETE error', error });
      return mapInventoryError(set, error, 'Failed to delete item', 'Item not found');
    }
  })

  // ==========================================
  // Consumable & Ammunition Usage (1 endpoint)
  // ==========================================

  /**
   * POST /v1/characters/:id/inventory/:itemId/use
   * Use consumable or ammunition
   */
  .post('/:id/inventory/:itemId/use', async ({ params, body, set, user }) => {
    try {
      const { quantity, sessionId, context } = body as {
        quantity?: number;
        sessionId?: string;
        context?: string;
      };

      if (sessionId) {
        const verification = await verifySessionOwnership(sessionId, (user as any).userId);
        if (!verification.success) {
          set.status = verification.error!.status;
          return { error: verification.error!.message };
        }
      }

      const input: UseConsumableInput = {
        characterId: params.id,
        itemId: params.itemId,
        quantity,
        sessionId,
        context,
      };

      const result = await InventoryService.useConsumable(input, (user as any).userId);

      return {
        remainingQuantity: result.remainingQuantity,
        itemDeleted: result.itemDeleted,
      };
    } catch (error) {
      logger.error({ msg: 'INVENTORY_USE error', error });
      return mapInventoryError(set, error, 'Failed to use item', 'Item not found');
    }
  })

  // ==========================================
  // Weight & Encumbrance (1 endpoint)
  // ==========================================

  /**
   * GET /v1/characters/:id/encumbrance
   * Get encumbrance status
   */
  .get('/:id/encumbrance', async ({ params, set, user }) => {
    try {
      const encumbrance = await InventoryService.checkEncumbrance(params.id, (user as any).userId);
      return encumbrance;
    } catch (error) {
      logger.error({ msg: 'ENCUMBRANCE_CHECK error', error });
      return mapInventoryError(set, error, 'Failed to check encumbrance', 'Character not found');
    }
  })

  // ==========================================
  // Attunement Management (3 endpoints)
  // ==========================================

  /**
   * POST /v1/characters/:id/attune/:itemId
   * Attune to a magic item
   */
  .post('/:id/attune/:itemId', async ({ params, set, user }) => {
    try {
      const result = await InventoryService.attuneItem(params.id, params.itemId, (user as any).userId);

      if (!result.success) {
        set.status = 400;
        return {
          error: result.error,
          currentAttunedCount: result.currentAttunedCount,
          maxAttunedCount: result.maxAttunedCount,
        };
      }

      return {
        success: true,
        attunedItem: result.attunedItem,
        currentAttunedCount: result.currentAttunedCount,
        maxAttunedCount: result.maxAttunedCount,
      };
    } catch (error) {
      logger.error({ msg: 'ATTUNE error', error });
      return mapInventoryError(set, error, 'Failed to attune to item', 'Item not found');
    }
  })

  /**
   * DELETE /v1/characters/:id/attune/:itemId
   * Break attunement with a magic item
   */
  .delete('/:id/attune/:itemId', async ({ params, set, user }) => {
    try {
      const item = await InventoryService.unattuneItem(params.itemId, params.id, (user as any).userId);

      if (!item) {
        set.status = 404;
        return { error: 'Item not found' };
      }

      return { success: true, item };
    } catch (error) {
      logger.error({ msg: 'UNATTUNE error', error });
      return mapInventoryError(set, error, 'Failed to unattune item', 'Item not found');
    }
  })

  /**
   * GET /v1/characters/:id/attuned
   * Get all attuned items
   */
  .get('/:id/attuned', async ({ params, set, user }) => {
    try {
      const items = await InventoryService.getAttunedItems(params.id, (user as any).userId);
      return { items };
    } catch (error) {
      logger.error({ msg: 'ATTUNED_ITEMS error', error });
      return mapInventoryError(set, error, 'Failed to fetch attuned items', 'Character not found');
    }
  })

  // ==========================================
  // Equipment Management (2 endpoints)
  // ==========================================

  /**
   * POST /v1/characters/:id/inventory/:itemId/equip
   * Equip weapon or armor
   */
  .post('/:id/inventory/:itemId/equip', async ({ params, set, user }) => {
    try {
      const result = await InventoryService.equipItem(params.id, params.itemId, (user as any).userId);

      if (!result.success) {
        set.status = 400;
        return { error: result.error };
      }

      return { success: true, item: result.equippedItem };
    } catch (error) {
      logger.error({ msg: 'EQUIP_ITEM error', error });
      return mapInventoryError(set, error, 'Failed to equip item', 'Item not found');
    }
  })

  /**
   * POST /v1/characters/:id/inventory/:itemId/unequip
   * Unequip item
   */
  .post('/:id/inventory/:itemId/unequip', async ({ params, set, user }) => {
    try {
      const item = await InventoryService.unequipItem(params.itemId, params.id, (user as any).userId);

      if (!item) {
        set.status = 404;
        return { error: 'Item not found' };
      }

      return { success: true, item };
    } catch (error) {
      logger.error({ msg: 'UNEQUIP_ITEM error', error });
      return mapInventoryError(set, error, 'Failed to unequip item', 'Item not found');
    }
  })

  // ==========================================
  // Usage History (1 endpoint)
  // ==========================================

  /**
   * GET /v1/characters/:id/usage-history
   * Get consumable usage history
   */
  .get('/:id/usage-history', async ({ params, query, set, user }) => {
    try {
      const sessionId = query.sessionId as string | undefined;
      if (sessionId) {
        const verification = await verifySessionOwnership(sessionId, (user as any).userId);
        if (!verification.success) {
          set.status = verification.error!.status;
          return { error: verification.error!.message };
        }
      }

      const history = await InventoryService.getUsageHistory({
        characterId: params.id,
        itemId: query.itemId as string | undefined,
        sessionId,
        limit: query.limit ? parseInt(query.limit as string) : undefined,
      }, (user as any).userId);

      return { history };
    } catch (error) {
      logger.error({ msg: 'USAGE_HISTORY error', error });
      return mapInventoryError(set, error, 'Failed to fetch usage history', 'Character not found');
    }
  });
