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

import { Elysia, t } from 'elysia';

import { verifySessionOwnership } from './combat/helpers.js';
import { mapAppRouteError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { requireAuth } from '../../middleware/auth.js';
import { InventoryAttunementService } from '../../services/inventory/inventory-attunement-service.js';
import { InventoryConsumableService } from '../../services/inventory/inventory-consumable-service.js';
import { InventoryService } from '../../services/inventory-service.js';
import { parseBoundedQueryInteger } from '../../utils/bounded-query-integer.js';

import type { GetInventoryOptions, ItemType } from '../../types/inventory.js';

const itemTypeSchema = t.Union([
  t.Literal('weapon'),
  t.Literal('armor'),
  t.Literal('consumable'),
  t.Literal('ammunition'),
  t.Literal('equipment'),
  t.Literal('treasure'),
]);

const createInventoryItemSchema = t.Object({
  name: t.String({ minLength: 1 }),
  itemType: itemTypeSchema,
  quantity: t.Optional(t.Number({ minimum: 1 })),
  weight: t.Optional(t.Number({ minimum: 0 })),
  description: t.Optional(t.Nullable(t.String())),
  properties: t.Optional(t.Nullable(t.Any())),
  isEquipped: t.Optional(t.Boolean()),
  isAttuned: t.Optional(t.Boolean()),
  requiresAttunement: t.Optional(t.Boolean()),
});

const updateInventoryItemSchema = t.Partial(createInventoryItemSchema);

const useConsumableSchema = t.Object({
  quantity: t.Optional(t.Number({ minimum: 1 })),
  sessionId: t.Optional(t.String()),
  context: t.Optional(t.String()),
});

function mapInventoryError(
  set: { status?: unknown },
  error: unknown,
  fallbackMessage: string,
  notFoundMessage = 'Not found',
): { error: string } {
  return mapAppRouteError(set, error, fallbackMessage, [404], notFoundMessage, 500);
}

export const inventoryRoutes = new Elysia({ prefix: '/v1/characters' })
  .use(requireAuth)
  /**
   * Centralized character ownership verification
   */
  .onBeforeHandle(async () => {
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
  .get(
    '/:id/inventory',
    async ({ params, query, set, user }) => {
      try {
        const options: GetInventoryOptions = {};

        if (query.itemType && typeof query.itemType === 'string') {
          options.itemType = query.itemType as ItemType;
        }
        if (query.equipped !== undefined) {
          options.equipped = query.equipped === 'true';
        }

        const inventory = await InventoryService.getInventory(
          params.id,
          (user as any).userId,
          options,
        );
        return inventory;
      } catch (error) {
        logger.error({ msg: 'INVENTORY_GET error', error });
        return mapInventoryError(set, error, 'Failed to fetch inventory', 'Character not found');
      }
    },
    {
      query: t.Object({
        itemType: t.Optional(t.String()),
        equipped: t.Optional(t.String()),
      }),
    },
  )

  /**
   * POST /v1/characters/:id/inventory
   * Add item to character inventory
   */
  .post(
    '/:id/inventory',
    async ({ params, body, set, user }) => {
      try {
        const item = await InventoryService.addItem(
          {
            ...(body as any),
            characterId: params.id,
          },
          (user as any).userId,
        );

        set.status = 201;
        return { item };
      } catch (error) {
        logger.error({ msg: 'INVENTORY_ADD error', error });
        return mapInventoryError(set, error, 'Failed to add item', 'Character not found');
      }
    },
    {
      body: createInventoryItemSchema,
    },
  )

  /**
   * PATCH /v1/characters/:id/inventory/:itemId
   * Update inventory item
   */
  .patch(
    '/:id/inventory/:itemId',
    async ({ params, body, set, user }) => {
      try {
        const item = await InventoryService.updateItem(
          params.itemId,
          params.id,
          (user as any).userId,
          body as any,
        );

        if (!item) {
          set.status = 404;
          return { error: 'Item not found' };
        }

        return { item };
      } catch (error) {
        logger.error({ msg: 'INVENTORY_UPDATE error', error });
        return mapInventoryError(set, error, 'Failed to update item', 'Item not found');
      }
    },
    {
      body: updateInventoryItemSchema,
    },
  )

  /**
   * DELETE /v1/characters/:id/inventory/:itemId
   * Remove item from inventory
   */
  .delete('/:id/inventory/:itemId', async ({ params, set, user }) => {
    try {
      const deleted = await InventoryService.removeItem(
        params.itemId,
        params.id,
        (user as any).userId,
      );

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
  .post(
    '/:id/inventory/:itemId/use',
    async ({ params, body, set, user }) => {
      try {
        const { quantity, sessionId, context } = body;

        if (sessionId) {
          const verification = await verifySessionOwnership(sessionId, (user as any).userId);
          if (!verification.success) {
            set.status = verification.error!.status;
            return { error: verification.error!.message };
          }
        }

        const result = await InventoryConsumableService.useConsumable(
          {
            characterId: params.id,
            itemId: params.itemId,
            quantity,
            sessionId,
            context,
          },
          (user as any).userId,
        );

        return {
          remainingQuantity: result.remainingQuantity,
          itemDeleted: result.itemDeleted,
        };
      } catch (error) {
        logger.error({ msg: 'INVENTORY_USE error', error });
        return mapInventoryError(set, error, 'Failed to use item', 'Item not found');
      }
    },
    {
      body: useConsumableSchema,
    },
  )

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
      const result = await InventoryAttunementService.attuneItem(
        params.id,
        params.itemId,
        (user as any).userId,
      );

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
      const item = await InventoryAttunementService.unattuneItem(
        params.itemId,
        params.id,
        (user as any).userId,
      );

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
      const items = await InventoryAttunementService.getAttunedItems(
        params.id,
        (user as any).userId,
      );
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
      const result = await InventoryService.equipItem(
        params.id,
        params.itemId,
        (user as any).userId,
      );

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
      const item = await InventoryService.unequipItem(
        params.itemId,
        params.id,
        (user as any).userId,
      );

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

      const history = await InventoryConsumableService.getUsageHistory(
        {
          characterId: params.id,
          itemId: query.itemId as string | undefined,
          sessionId,
          limit: parseBoundedQueryInteger(query.limit, { min: 1, max: 100 }),
        },
        (user as any).userId,
      );

      return { history };
    } catch (error) {
      logger.error({ msg: 'USAGE_HISTORY error', error });
      return mapInventoryError(set, error, 'Failed to fetch usage history', 'Character not found');
    }
  });
