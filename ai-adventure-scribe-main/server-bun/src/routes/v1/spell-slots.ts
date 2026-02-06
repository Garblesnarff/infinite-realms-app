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
 */

import { Elysia } from 'elysia';
import { authenticateRequest } from '../../lib/auth.js';
import { logger } from '../../lib/logger.js';
import { supabaseService } from '../../lib/supabase.js';
import { verifySessionOwnership } from './combat/helpers.js';

// Import service from Bun server
import { SpellSlotsService } from '../../services/spell-slots-service.js';
import type {
  UseSpellSlotInput,
  RestoreSpellSlotsInput,
  SpellSlotUsageQuery,
  ClassName,
} from '../../types/spell-slots.js';

/**
 * Helper to verify character ownership
 */
async function verifyCharacterOwnership(
  characterId: string,
  userId: string
): Promise<{ success: true } | { success: false; status: number; error: string }> {
  const { data: character, error: charErr } = await supabaseService
    .from('characters')
    .select('user_id, owner_id')
    .eq('id', characterId)
    .single();

  if (charErr || !character || (character.user_id !== userId && character.owner_id !== userId)) {
    return { success: false, status: 404, error: 'Character not found' };
  }


  return { success: true };
}

// Character-specific spell slot routes
export const spellSlotsCharacterRoutes = new Elysia({ prefix: '/v1/characters' })

  /**
   * GET /v1/characters/:id/spell-slots
   * Get all spell slots for a character
   */
  .get('/:id/spell-slots', async ({ request, params, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const ownership = await verifyCharacterOwnership(params.id, user.userId);
      if (!ownership.success) {
        set.status = ownership.status;
        return { error: ownership.error };
      }

      const spellSlots = await SpellSlotsService.getCharacterSpellSlots(params.id);
      return spellSlots;
    } catch (error) {
      logger.error({ msg: 'SPELL_SLOTS_GET error', error });
      set.status = 500;
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
  .post('/:id/spell-slots/use', async ({ request, params, body, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const ownership = await verifyCharacterOwnership(params.id, user.userId);
      if (!ownership.success) {
        set.status = ownership.status;
        return { error: ownership.error };
      }

      const { spellName, spellLevel, slotLevelUsed, sessionId } = body as any;

      if (sessionId) {
        const verification = await verifySessionOwnership(sessionId, user.userId);
        if (!verification.success) {
          set.status = verification.error!.status;
          return { error: verification.error!.message };
        }
      }

      // Validate input
      if (!spellName) {
        set.status = 400;
        return { error: 'spellName is required' };
      }

      if (spellLevel === undefined || spellLevel < 0 || spellLevel > 9) {
        set.status = 400;
        return { error: 'spellLevel must be between 0 and 9' };
      }

      if (slotLevelUsed === undefined || slotLevelUsed < 1 || slotLevelUsed > 9) {
        set.status = 400;
        return { error: 'slotLevelUsed must be between 1 and 9' };
      }

      const result = await SpellSlotsService.useSpellSlot({
        characterId: params.id,
        spellName,
        spellLevel,
        slotLevelUsed,
        sessionId,
      });

      return result;
    } catch (error) {
      logger.error({ msg: 'SPELL_SLOT_USE error', error });
      set.status = 500;
      return {
        error: 'Failed to use spell slot',
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  })

  /**
   * POST /v1/characters/:id/spell-slots/restore
   * Restore spell slots (long rest or specific restoration)
   */
  .post('/:id/spell-slots/restore', async ({ request, params, body, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const ownership = await verifyCharacterOwnership(params.id, user.userId);
      if (!ownership.success) {
        set.status = ownership.status;
        return { error: ownership.error };
      }

      const { level, amount } = body as any;

      const result = await SpellSlotsService.restoreSpellSlots({
        characterId: params.id,
        level,
        amount,
      });

      return result;
    } catch (error) {
      logger.error({ msg: 'SPELL_SLOTS_RESTORE error', error });
      set.status = 500;
      return {
        error: 'Failed to restore spell slots',
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  })

  /**
   * GET /v1/characters/:id/spell-slots/history
   * Get spell slot usage history
   */
  .get('/:id/spell-slots/history', async ({ request, params, query, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const ownership = await verifyCharacterOwnership(params.id, user.userId);
      if (!ownership.success) {
        set.status = ownership.status;
        return { error: ownership.error };
      }

      const usageQuery: SpellSlotUsageQuery = {
        characterId: params.id,
        sessionId: query.sessionId as string | undefined,
        limit: query.limit ? parseInt(query.limit as string, 10) : 50,
        offset: query.offset ? parseInt(query.offset as string, 10) : 0,
      };

      if (usageQuery.sessionId) {
        const verification = await verifySessionOwnership(usageQuery.sessionId, user.userId);
        if (!verification.success) {
          set.status = verification.error!.status;
          return { error: verification.error!.message };
        }
      }

      const history = await SpellSlotsService.getSpellSlotUsageHistory(usageQuery);
      return history;
    } catch (error) {
      logger.error({ msg: 'SPELL_SLOTS_HISTORY error', error });
      set.status = 500;
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
  .post('/:id/spell-slots/initialize', async ({ request, params, body, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const ownership = await verifyCharacterOwnership(params.id, user.userId);
      if (!ownership.success) {
        set.status = ownership.status;
        return { error: ownership.error };
      }

      const { classes } = body as { classes: Array<{ className: ClassName; level: number }> };

      if (!classes || !Array.isArray(classes) || classes.length === 0) {
        set.status = 400;
        return { error: 'classes array is required' };
      }

      const spellSlots = await SpellSlotsService.initializeSpellSlots(params.id, classes);

      set.status = 201;
      return spellSlots;
    } catch (error) {
      logger.error({ msg: 'SPELL_SLOTS_INIT error', error });
      set.status = 500;
      return {
        error: 'Failed to initialize spell slots',
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

// Utility spell slot routes (not character-specific)
export const spellSlotsUtilityRoutes = new Elysia({ prefix: '/v1/spell-slots' })

  /**
   * GET /v1/spell-slots/calculate
   * Calculate spell slots for preview (doesn't save to database)
   */
  .get('/calculate', async ({ request, query, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

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
      set.status = 500;
      return {
        error: 'Failed to calculate spell slots',
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  })

  /**
   * POST /v1/spell-slots/calculate-multiclass
   * Calculate multiclass spell slots for preview
   */
  .post('/calculate-multiclass', async ({ request, body, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

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
      set.status = 500;
      return {
        error: 'Failed to calculate multiclass spell slots',
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  })

  /**
   * GET /v1/spell-slots/can-upcast
   * Check if a spell can be upcast
   */
  .get('/can-upcast', async ({ request, query, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

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
      set.status = 500;
      return {
        error: 'Failed to check upcast',
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
