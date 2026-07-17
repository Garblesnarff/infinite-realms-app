/**
 * Progression Routes (Elysia/Bun)
 *
 * REST endpoints for D&D 5E experience points, leveling system,
 * and character progression tracking:
 * - Award XP
 * - Get progression status
 * - Level-up operations
 * - XP history
 * - Milestone leveling
 *
 * Ported from /server/src/routes/v1/progression.ts
 *
 * @deprecated Award XP, level-up, and milestone mutation endpoints have no frontend callers as of 2026-07-08.
 */

import { Elysia, t } from 'elysia';

import { verifySessionOwnership } from './combat/helpers.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { requireAuth } from '../../middleware/auth.js';
import { CharacterService } from '../../services/character-service.js';
import { ProgressionService } from '../../services/progression-service.js';

import type { XPSource } from '../../types/progression.js';

const characterIdParams = t.Object({
  id: t.String({ minLength: 1, maxLength: 255 }),
});

const awardXPSchema = t.Object({
  // Optional fields retain the established manual validation errors for omissions.
  xp: t.Optional(t.Number({ minimum: 0, maximum: 1_000_000 })),
  source: t.Optional(t.Union([
    t.Literal('combat'),
    t.Literal('quest'),
    t.Literal('roleplay'),
    t.Literal('milestone'),
    t.Literal('other'),
  ])),
  description: t.Optional(t.String({ maxLength: 10_000 })),
  sessionId: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
});

const levelUpSchema = t.Object({
  hpRoll: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
  abilityScoreImprovements: t.Optional(t.Array(t.Object({
    ability: t.Union([
      t.Literal('strength'),
      t.Literal('dexterity'),
      t.Literal('constitution'),
      t.Literal('intelligence'),
      t.Literal('wisdom'),
      t.Literal('charisma'),
    ]),
    increase: t.Number({ minimum: 1, maximum: 2 }),
  }), { maxItems: 2 })),
  featSelected: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
  classFeatures: t.Optional(t.Array(t.String({ minLength: 1, maxLength: 255 }), { maxItems: 100 })),
  spellsLearned: t.Optional(t.Array(t.String({ minLength: 1, maxLength: 255 }), { maxItems: 100 })),
});

const levelUpOptionsQuery = t.Object({
  newLevel: t.Optional(t.String({ minLength: 1, maxLength: 3 })),
});

const xpHistoryQuery = t.Object({
  sessionId: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
  limit: t.Optional(t.String({ minLength: 1, maxLength: 6 })),
});

const milestoneLevelSchema = t.Object({
  level: t.Optional(t.Number({ minimum: 1, maximum: 20 })),
  reason: t.Optional(t.String({ maxLength: 10_000 })),
});

function mapProgressionError(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  set: any,
  error: unknown,
  fallbackMessage: string
) {
  if (error instanceof AppError) {
    if (error.statusCode === 404) {
      set.status = 404;
      return { error: 'Character not found' };
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

export const progressionRoutes = new Elysia({ prefix: '/v1/progression' })
  .use(requireAuth)
  /**
   * Centralized character ownership verification
   */
  .onBeforeHandle(async ({ user, params, set }) => {
    if (params.id) {
      // Sentinel: Verify ownership directly in the database query
      // and throw 404 for unauthorized access to prevent existence leakage.
      const character = await CharacterService.getById(params.id, user.userId);
      if (!character) {
        set.status = 404;
        return { error: 'Character not found' };
      }
    }
  })

  /**
   * POST /v1/progression/characters/:id/experience/award
   * Award experience points to a character
   */
  .post('/characters/:id/experience/award', async ({ params, body, set, user }) => {
    try {

      const { xp, source, description, sessionId } = body;

      if (sessionId) {
        const verification = await verifySessionOwnership(sessionId, (user as { userId: string }).userId);
        if (!verification.success) {
          set.status = verification.error!.status;
          return { error: verification.error!.message };
        }
      }

      // Validate XP
      if (xp === undefined || xp < 0) {
        set.status = 400;
        return { error: 'XP must be a non-negative number' };
      }

      // Validate source
      const validSources: XPSource[] = ['combat', 'quest', 'roleplay', 'milestone', 'other'];
      if (!source || !validSources.includes(source)) {
        set.status = 400;
        return { error: 'Valid source is required (combat, quest, roleplay, milestone, other)' };
      }

      const result = await ProgressionService.awardXP(
        params.id,
        xp,
        source,
        (user as { userId: string }).userId,
        description,
        sessionId
      );

      return result;
    } catch (error) {
      logger.error({ msg: 'PROGRESSION_AWARD_XP error', error });
      return mapProgressionError(set, error, 'Failed to award XP');
    }
  }, { params: characterIdParams, body: awardXPSchema })

  /**
   * GET /v1/progression/characters/:id/progression
   * Get character's current progression status
   */
  .get('/characters/:id/progression', async ({ params, set, user }) => {
    try {
      const progression = await ProgressionService.getProgression(params.id, (user as { userId: string }).userId);
      return progression;
    } catch (error) {
      logger.error({ msg: 'PROGRESSION_GET error', error });
      return mapProgressionError(set, error, 'Failed to get progression');
    }
  }, { params: characterIdParams })

  /**
   * POST /v1/progression/characters/:id/level-up
   * Perform a level-up
   */
  .post('/characters/:id/level-up', async ({ params, body, set, user }) => {
    try {
      const userId = (user as { userId: string }).userId;

      // Check if character can level up
      const canLevel = await ProgressionService.canLevelUp(params.id, userId);
      if (!canLevel) {
        set.status = 400;
        return { error: 'Character does not have enough XP to level up' };
      }

      const result = await ProgressionService.levelUp({
        characterId: params.id,
        ...body,
      }, userId);

      return result;
    } catch (error) {
      logger.error({ msg: 'PROGRESSION_LEVELUP error', error });
      return mapProgressionError(set, error, 'Failed to level up');
    }
  }, { params: characterIdParams, body: levelUpSchema })

  /**
   * GET /v1/progression/characters/:id/level-up-options
   * Get available options for leveling up
   */
  .get('/characters/:id/level-up-options', async ({ params, query, set, user }) => {
    try {
      const { newLevel } = query;

      if (!newLevel) {
        set.status = 400;
        return { error: 'newLevel query parameter is required' };
      }

      const level = parseInt(newLevel);
      if (isNaN(level) || level < 1 || level > 20) {
        set.status = 400;
        return { error: 'newLevel must be between 1 and 20' };
      }

      const options = await ProgressionService.getLevelUpOptions(params.id, level, (user as { userId: string }).userId);
      return options;
    } catch (error) {
      logger.error({ msg: 'PROGRESSION_LEVELUP_OPTIONS error', error });
      return mapProgressionError(set, error, 'Failed to get level-up options');
    }
  }, { params: characterIdParams, query: levelUpOptionsQuery })

  /**
   * GET /v1/progression/characters/:id/experience-history
   * Get XP history for a character
   */
  .get('/characters/:id/experience-history', async ({ params, query, set, user }) => {
    try {
      const { sessionId, limit } = query;

      if (sessionId) {
        const verification = await verifySessionOwnership(sessionId, (user as { userId: string }).userId);
        if (!verification.success) {
          set.status = verification.error!.status;
          return { error: verification.error!.message };
        }
      }

      const events = await ProgressionService.getXPHistory(
        params.id,
        (user as { userId: string }).userId,
        sessionId,
        limit ? parseInt(limit) : undefined
      );

      return { events };
    } catch (error) {
      logger.error({ msg: 'PROGRESSION_HISTORY error', error });
      return mapProgressionError(set, error, 'Failed to get XP history');
    }
  }, { params: characterIdParams, query: xpHistoryQuery })

  /**
   * POST /v1/progression/characters/:id/milestone-level
   * Set character level directly (milestone leveling)
   */
  .post('/characters/:id/milestone-level', async ({ params, body, set, user }) => {
    try {
      const { level, reason } = body;

      if (level === undefined || level < 1 || level > 20) {
        set.status = 400;
        return { error: 'Level must be between 1 and 20' };
      }

      const result = await ProgressionService.setLevel(params.id, level, (user as { userId: string }).userId, reason);
      return result;
    } catch (error) {
      logger.error({ msg: 'PROGRESSION_MILESTONE error', error });
      return mapProgressionError(set, error, 'Failed to set milestone level');
    }
  }, { params: characterIdParams, body: milestoneLevelSchema })

  /**
   * GET /v1/progression/xp-table
   * Get the D&D 5E XP threshold table
   */
  .get('/xp-table', async ({ set }) => {
    try {
      const xpTable = ProgressionService.getXPTable();
      return { xpTable };
    } catch (error) {
      logger.error({ msg: 'PROGRESSION_XPTABLE error', error });
      return mapProgressionError(set, error, 'Failed to get XP table');
    }
  });
