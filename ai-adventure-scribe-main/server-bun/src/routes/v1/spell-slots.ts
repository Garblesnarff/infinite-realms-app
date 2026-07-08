/**
 * Spell Slots Routes (Elysia/Bun)
 *
 * REST endpoints for D&D 5E spell slot tracking and management:
 * - Get/use/restore spell slots
 * - Usage history tracking
 * - Slot calculation (single class & multiclass)
 * - Upcast validation
 *
 * Ported from /server/src/routes/v1/spell-slots.ts
 *
 * @deprecated Calculation and history helper endpoints have no frontend callers as of 2026-07-08.
 */

import { Elysia, t } from 'elysia';

import { verifySessionOwnership } from './combat/helpers.js';
import { authenticateRequest } from '../../lib/auth.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { CharacterService } from '../../services/character-service.js';
import { SpellSlotsService } from '../../services/spell-slots-service.js';

import type {
  SpellSlotUsageQuery,
  ClassName,
} from '../../types/spell-slots.js';

const useSpellSlotSchema = t.Object({
  spellName: t.String({ minLength: 1 }),
  spellLevel: t.Number({ minimum: 0, maximum: 9 }),
  slotLevelUsed: t.Number({ minimum: 1, maximum: 9 }),
  sessionId: t.Optional(t.String()),
});

const restoreSpellSlotsSchema = t.Object({
  level: t.Optional(t.Number({ minimum: 1, maximum: 9 })),
  amount: t.Optional(t.Number({ minimum: 0 })),
});

const initializeSpellSlotsSchema = t.Object({
  classes: t.Array(
    t.Object({
      className: t.String({ minLength: 1 }),
      level: t.Number({ minimum: 1, maximum: 20 }),
    })
  ),
});

function mapSpellSlotsError(
  set: any,
  error: unknown,
  fallbackMessage: string,
  notFoundMessage: string = 'Not found'
): { error: string; details?: string } {
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
  return { error: fallbackMessage, details: error instanceof Error ? error.message : 'Unknown error' };
}

// Character-specific spell slot routes
export const spellSlotsCharacterRoutes = new Elysia({ prefix: '/v1/characters' })
  /**
   * Centralized authentication and character ownership verification
   */
  .derive(async ({ request }) => {
    const { user, error: authError } = await authenticateRequest(request);
    return { user, authError };
  })
  .onBeforeHandle(async ({ user, authError, params, set }) => {
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (params.id) {
      // 🛡️ Sentinel: Use CharacterService.getById which verifies dual-ownership (userId/ownerId)
      // and masks existence by returning null for unauthorized access.
      const character = await CharacterService.getById(params.id, user.userId);
      if (!character) {
        set.status = 404;
        return { error: 'Character not found' };
      }
    }
  })

  /**
   * GET /v1/characters/:id/spell-slots
   * Get all spell slots for a character
   */
  .get('/:id/spell-slots', async ({ params, set, user }) => {
    try {
      const spellSlots = await SpellSlotsService.getCharacterSpellSlots(
        params.id,
        (user as { userId: string }).userId
      );
      return spellSlots;
    } catch (error) {
      logger.error({ msg: 'SPELL_SLOTS_GET error', error });
      set.status = error instanceof Error && 'status' in (error as any) ? (error as any).status : 500;
      return {
        error: 'Failed to get spell slots',
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  })

  /**
   * POST /v1/characters/:id/spell-slots/use
   * Use a spell slot
   */
  .post(
    '/:id/spell-slots/use',
    async ({ params, body, set, user }) => {
      try {
        const { spellName, spellLevel, slotLevelUsed, sessionId } = body;

        if (sessionId) {
          const verification = await verifySessionOwnership(sessionId, (user as any).userId);
          if (!verification.success) {
            set.status = verification.error!.status;
            return { error: verification.error!.message };
          }
        }

        const result = await SpellSlotsService.useSpellSlot(
          {
            characterId: params.id,
            spellName,
            spellLevel,
            slotLevelUsed,
            sessionId,
          },
          (user as { userId: string }).userId
        );

        return result;
      } catch (error) {
        logger.error({ msg: 'SPELL_SLOT_USE error', error });
        return mapSpellSlotsError(set, error, 'Failed to use spell slot');
      }
    },
    {
      body: useSpellSlotSchema,
    }
  )

  /**
   * POST /v1/characters/:id/spell-slots/restore
   * Restore spell slots (long rest or specific restoration)
   */
  .post(
    '/:id/spell-slots/restore',
    async ({ params, body, set, user }) => {
      try {
        const { level, amount } = body;

        const result = await SpellSlotsService.restoreSpellSlots(
          {
            characterId: params.id,
            level,
            amount,
          },
          (user as { userId: string }).userId
        );

        return result;
      } catch (error) {
        logger.error({ msg: 'SPELL_SLOTS_RESTORE error', error });
        return mapSpellSlotsError(set, error, 'Failed to restore spell slots');
      }
    },
    {
      body: restoreSpellSlotsSchema,
    }
  )

  /**
   * GET /v1/characters/:id/spell-slots/history
   * Get spell slot usage history
   */
  .get('/:id/spell-slots/history', async ({ params, query, set, user }) => {
    try {
      const usageQuery: SpellSlotUsageQuery = {
        characterId: params.id,
        sessionId: query.sessionId as string | undefined,
        limit: query.limit ? parseInt(query.limit as string, 10) : 50,
        offset: query.offset ? parseInt(query.offset as string, 10) : 0,
      };

      const history = await SpellSlotsService.getSpellSlotUsageHistory(
        usageQuery,
        (user as { userId: string }).userId
      );
      return history;
    } catch (error) {
      logger.error({ msg: 'SPELL_SLOTS_HISTORY error', error });
      set.status = error instanceof Error && 'status' in (error as any) ? (error as any).status : 500;
      return {
        error: 'Failed to get spell slot history',
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  })

  /**
   * POST /v1/characters/:id/spell-slots/initialize
   * Initialize spell slots for a character based on their class(es) and level(s)
   */
  .post(
    '/:id/spell-slots/initialize',
    async ({ params, body, set, user }) => {
      try {
        const { classes } = body;

        const spellSlots = await SpellSlotsService.initializeSpellSlots(
          params.id,
          (user as { userId: string }).userId,
          classes as any
        );

        set.status = 201;
        return spellSlots;
      } catch (error) {
        logger.error({ msg: 'SPELL_SLOTS_INIT error', error });
        return mapSpellSlotsError(set, error, 'Failed to initialize spell slots');
      }
    },
    {
      body: initializeSpellSlotsSchema,
    }
  );

// Utility spell slot routes (not character-specific)
export const spellSlotsUtilityRoutes = new Elysia({ prefix: '/v1/spell-slots' })
  .derive(async ({ request }) => {
    const { user, error: authError } = await authenticateRequest(request);
    return { user, authError };
  })
  .onBeforeHandle(async ({ user, authError, set }) => {
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
  })

  /**
   * GET /v1/spell-slots/calculate
   * Calculate spell slots for preview (doesn't save to database)
   */
  .get('/calculate', async ({ query, set }) => {
    try {
      const { className, level } = query;

      if (!className) {
        set.status = 400;
        return { error: 'className is required' };
      }

      if (!level) {
        set.status = 400;
        return { error: 'level is required' };
      }

      const parsedLevel = parseInt(level as string, 10);

      if (isNaN(parsedLevel) || parsedLevel < 1 || parsedLevel > 20) {
        set.status = 400;
        return { error: 'level must be between 1 and 20' };
      }

      const calculation = SpellSlotsService.calculateSpellSlots(
        className as ClassName,
        parsedLevel
      );

      return calculation;
    } catch (error) {
      logger.error({ msg: 'SPELL_SLOTS_CALC error', error });
      return mapSpellSlotsError(set, error, 'Failed to calculate spell slots');
    }
  })

  /**
   * POST /v1/spell-slots/calculate-multiclass
   * Calculate multiclass spell slots for preview
   */
  .post('/calculate-multiclass', async ({ body, set }) => {
    try {
      const { classes } = body as { classes: Array<{ className: ClassName; level: number }> };

      if (!classes || !Array.isArray(classes) || classes.length === 0) {
        set.status = 400;
        return { error: 'classes array is required' };
      }

      for (const classInfo of classes) {
        if (!classInfo.className) {
          set.status = 400;
          return { error: 'className is required for each class' };
        }

        if (!classInfo.level || classInfo.level < 1 || classInfo.level > 20) {
          set.status = 400;
          return { error: 'level must be between 1 and 20 for each class' };
        }
      }

      const calculation = SpellSlotsService.calculateMulticlassSpellSlots(classes);
      return calculation;
    } catch (error) {
      logger.error({ msg: 'SPELL_SLOTS_MULTICLASS error', error });
      return mapSpellSlotsError(set, error, 'Failed to calculate multiclass spell slots');
    }
  })

  /**
   * GET /v1/spell-slots/can-upcast
   * Check if a spell can be upcast
   */
  .get('/can-upcast', async ({ query, set }) => {
    try {
      const { spellName, baseLevel, targetLevel } = query;

      if (!spellName) {
        set.status = 400;
        return { error: 'spellName is required' };
      }

      if (baseLevel === undefined) {
        set.status = 400;
        return { error: 'baseLevel is required' };
      }

      if (targetLevel === undefined) {
        set.status = 400;
        return { error: 'targetLevel is required' };
      }

      const parsedBaseLevel = parseInt(baseLevel as string, 10);
      const parsedTargetLevel = parseInt(targetLevel as string, 10);

      if (isNaN(parsedBaseLevel) || parsedBaseLevel < 0 || parsedBaseLevel > 9) {
        set.status = 400;
        return { error: 'baseLevel must be between 0 and 9' };
      }

      if (isNaN(parsedTargetLevel) || parsedTargetLevel < 1 || parsedTargetLevel > 9) {
        set.status = 400;
        return { error: 'targetLevel must be between 1 and 9' };
      }

      const validation = SpellSlotsService.canUpcast(
        spellName as string,
        parsedBaseLevel,
        parsedTargetLevel
      );

      return validation;
    } catch (error) {
      logger.error({ msg: 'SPELL_SLOTS_UPCAST error', error });
      return mapSpellSlotsError(set, error, 'Failed to check upcast');
    }
  });
