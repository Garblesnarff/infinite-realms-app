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

import { Elysia } from 'elysia';
import { authenticateRequest } from '../../lib/auth.js';
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

export const inventoryRoutes = new Elysia({ prefix: '/v1/characters' })

  // ==========================================
  // Inventory Management (4 endpoints)
  // ==========================================

  /**
   * GET /v1/characters/:id/inventory
   * Get character inventory with optional filters
   */
  .get('/:id/inventory', async ({ request, params, query, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const options: GetInventoryOptions = {};

      if (query.itemType && typeof query.itemType === 'string') {
        options.itemType = query.itemType as ItemType;
      }
      if (query.equipped !== undefined) {
        options.equipped = query.equipped === 'true';
      }

      const inventory = await InventoryService.getInventory(params.id, options);
      return inventory;
    } catch (error) {
      logger.error({ msg: 'INVENTORY_GET error', error });
      set.status = 500;
      return {
        error: 'Failed to fetch inventory',
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  })

  /**
   * POST /v1/characters/:id/inventory
   * Add item to character inventory
   */
  .post('/:id/inventory', async ({ request, params, body, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const itemData = body as any;

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

      const item = await InventoryService.addItem(input);

      set.status = 201;
      return { item };
    } catch (error) {
      logger.error({ msg: 'INVENTORY_ADD error', error });
      set.status = 500;
      return {
        error: 'Failed to add item',
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  })

  /**
   * PATCH /v1/characters/:id/inventory/:itemId
   * Update inventory item
   */
  .patch('/:id/inventory/:itemId', async ({ request, params, body, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const updates = body as any;
      const input: UpdateInventoryItemInput = {};

      if (updates.name !== undefined) input.name = updates.name;
      if (updates.quantity !== undefined) input.quantity = updates.quantity;
      if (updates.weight !== undefined) input.weight = updates.weight;
      if (updates.description !== undefined) input.description = updates.description;
      if (updates.properties !== undefined) input.properties = updates.properties;
      if (updates.isEquipped !== undefined) input.isEquipped = updates.isEquipped;
      if (updates.isAttuned !== undefined) input.isAttuned = updates.isAttuned;

      const item = await InventoryService.updateItem(params.itemId, input);

      if (!item) {
        set.status = 404;
        return { error: 'Item not found' };
      }

      return { item };
    } catch (error) {
      logger.error({ msg: 'INVENTORY_UPDATE error', error });
      set.status = 500;
      return {
        error: 'Failed to update item',
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  })

  /**
   * DELETE /v1/characters/:id/inventory/:itemId
   * Remove item from inventory
   */
  .delete('/:id/inventory/:itemId', async ({ request, params, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const deleted = await InventoryService.removeItem(params.itemId);

      if (!deleted) {
        set.status = 404;
        return { error: 'Item not found' };
      }

      return { deleted: true };
    } catch (error) {
      logger.error({ msg: 'INVENTORY_DELETE error', error });
      set.status = 500;
      return {
        error: 'Failed to delete item',
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  })

  // ==========================================
  // Consumable & Ammunition Usage (1 endpoint)
  // ==========================================

  /**
   * POST /v1/characters/:id/inventory/:itemId/use
   * Use consumable or ammunition
   */
  .post('/:id/inventory/:itemId/use', async ({ request, params, body, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const { quantity, sessionId, context } = body as any;

      const input: UseConsumableInput = {
        characterId: params.id,
        itemId: params.itemId,
        quantity,
        sessionId,
        context,
      };

      const result = await InventoryService.useConsumable(input);

      return {
        remainingQuantity: result.remainingQuantity,
        itemDeleted: result.itemDeleted,
      };
    } catch (error) {
      logger.error({ msg: 'INVENTORY_USE error', error });
      set.status = 400;
      return {
        error: 'Failed to use item',
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  })

  // ==========================================
  // Weight & Encumbrance (1 endpoint)
  // ==========================================

  /**
   * GET /v1/characters/:id/encumbrance
   * Get encumbrance status
   */
  .get('/:id/encumbrance', async ({ request, params, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const encumbrance = await InventoryService.checkEncumbrance(params.id);
      return encumbrance;
    } catch (error) {
      logger.error({ msg: 'ENCUMBRANCE_CHECK error', error });
      set.status = 500;
      return {
        error: 'Failed to check encumbrance',
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  })

  // ==========================================
  // Attunement Management (3 endpoints)
  // ==========================================

  /**
   * POST /v1/characters/:id/attune/:itemId
   * Attune to a magic item
   */
  .post('/:id/attune/:itemId', async ({ request, params, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const result = await InventoryService.attuneItem(params.id, params.itemId);

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
      set.status = 500;
      return {
        error: 'Failed to attune to item',
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  })

  /**
   * DELETE /v1/characters/:id/attune/:itemId
   * Break attunement with a magic item
   */
  .delete('/:id/attune/:itemId', async ({ request, params, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const item = await InventoryService.unattuneItem(params.itemId);

      if (!item) {
        set.status = 404;
        return { error: 'Item not found' };
      }

      return { success: true, item };
    } catch (error) {
      logger.error({ msg: 'UNATTUNE error', error });
      set.status = 500;
      return {
        error: 'Failed to unattune item',
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  })

  /**
   * GET /v1/characters/:id/attuned
   * Get all attuned items
   */
  .get('/:id/attuned', async ({ request, params, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const items = await InventoryService.getAttunedItems(params.id);
      return { items };
    } catch (error) {
      logger.error({ msg: 'ATTUNED_ITEMS error', error });
      set.status = 500;
      return {
        error: 'Failed to fetch attuned items',
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  })

  // ==========================================
  // Equipment Management (2 endpoints)
  // ==========================================

  /**
   * POST /v1/characters/:id/inventory/:itemId/equip
   * Equip weapon or armor
   */
  .post('/:id/inventory/:itemId/equip', async ({ request, params, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const result = await InventoryService.equipItem(params.id, params.itemId);

      if (!result.success) {
        set.status = 400;
        return { error: result.error };
      }

      return { success: true, item: result.equippedItem };
    } catch (error) {
      logger.error({ msg: 'EQUIP_ITEM error', error });
      set.status = 500;
      return {
        error: 'Failed to equip item',
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  })

  /**
   * POST /v1/characters/:id/inventory/:itemId/unequip
   * Unequip item
   */
  .post('/:id/inventory/:itemId/unequip', async ({ request, params, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const item = await InventoryService.unequipItem(params.itemId);

      if (!item) {
        set.status = 404;
        return { error: 'Item not found' };
      }

      return { success: true, item };
    } catch (error) {
      logger.error({ msg: 'UNEQUIP_ITEM error', error });
      set.status = 500;
      return {
        error: 'Failed to unequip item',
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  })

  // ==========================================
  // Usage History (1 endpoint)
  // ==========================================

  /**
   * GET /v1/characters/:id/usage-history
   * Get consumable usage history
   */
  .get('/:id/usage-history', async ({ request, params, query, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const history = await InventoryService.getUsageHistory({
        characterId: params.id,
        itemId: query.itemId as string | undefined,
        sessionId: query.sessionId as string | undefined,
        limit: query.limit ? parseInt(query.limit as string) : undefined,
      });

      return { history };
    } catch (error) {
      logger.error({ msg: 'USAGE_HISTORY error', error });
      set.status = 500;
      return {
        error: 'Failed to fetch usage history',
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
