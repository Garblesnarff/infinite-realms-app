/**
 * Spell Slots Routes (Elysia/Bun)
 *
 * REST endpoints for D&D 5E spell slot calculation/validation (preview-only,
 * not character-specific):
 * - Slot calculation (single class & multiclass)
 * - Upcast validation
 *
 * Ported from /server/src/routes/v1/spell-slots.ts
 *
 * The character-specific spellSlotsCharacterRoutes (get/use/restore/
 * initialize/history under /v1/characters/:id/spell-slots/*) were removed in
 * the 2026-07-22 dead-code sweep — zero frontend/e2e/test callers; combat
 * spellcasting resolves server-side via SpellSlotsService directly (see
 * services/combat/combat-attack-service.ts), not through this route. The
 * utility routes below are kept because
 * starter-template-http-contract.test.ts exercises them as auth-boundary
 * regression checks.
 */

import { Elysia, t } from 'elysia';

import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { requireAuth } from '../../middleware/auth.js';
import { SpellSlotsService } from '../../services/spell-slots-service.js';

import type { ClassName } from '../../types/spell-slots.js';

const calculateSpellSlotsQuery = t.Object({
  className: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
  level: t.Optional(t.String({ minLength: 1, maxLength: 3 })),
});

const calculateMulticlassSchema = t.Object({
  // Optional retains the route's existing missing-array validation response.
  classes: t.Optional(t.Array(t.Object({
    className: t.String({ minLength: 1, maxLength: 100 }),
    level: t.Number({ minimum: 1, maximum: 20 }),
  }), { minItems: 1, maxItems: 20 })),
});

const canUpcastQuery = t.Object({
  spellName: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
  baseLevel: t.Optional(t.String({ minLength: 1, maxLength: 2 })),
  targetLevel: t.Optional(t.String({ minLength: 1, maxLength: 2 })),
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

// Utility spell slot routes (not character-specific)
export const spellSlotsUtilityRoutes = new Elysia({ prefix: '/v1/spell-slots' })
  .use(requireAuth)

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

      const parsedLevel = parseInt(level, 10);

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
  }, { query: calculateSpellSlotsQuery })

  /**
   * POST /v1/spell-slots/calculate-multiclass
   * Calculate multiclass spell slots for preview
   */
  .post('/calculate-multiclass', async ({ body, set }) => {
    try {
      const { classes } = body;

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

      const calculation = SpellSlotsService.calculateMulticlassSpellSlots(
        classes as Array<{ className: ClassName; level: number }>,
      );
      return calculation;
    } catch (error) {
      logger.error({ msg: 'SPELL_SLOTS_MULTICLASS error', error });
      return mapSpellSlotsError(set, error, 'Failed to calculate multiclass spell slots');
    }
  }, { body: calculateMulticlassSchema })

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

      const parsedBaseLevel = parseInt(baseLevel, 10);
      const parsedTargetLevel = parseInt(targetLevel, 10);

      if (isNaN(parsedBaseLevel) || parsedBaseLevel < 0 || parsedBaseLevel > 9) {
        set.status = 400;
        return { error: 'baseLevel must be between 0 and 9' };
      }

      if (isNaN(parsedTargetLevel) || parsedTargetLevel < 1 || parsedTargetLevel > 9) {
        set.status = 400;
        return { error: 'targetLevel must be between 1 and 9' };
      }

      const validation = SpellSlotsService.canUpcast(
        spellName,
        parsedBaseLevel,
        parsedTargetLevel
      );

      return validation;
    } catch (error) {
      logger.error({ msg: 'SPELL_SLOTS_UPCAST error', error });
      return mapSpellSlotsError(set, error, 'Failed to check upcast');
    }
  }, { query: canUpcastQuery });
