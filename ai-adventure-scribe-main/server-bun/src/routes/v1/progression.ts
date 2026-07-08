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

import { Elysia } from 'elysia';

import { verifySessionOwnership } from './combat/helpers.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { requireAuth } from '../../middleware/auth.js';
import { CharacterService } from '../../services/character-service.js';
import { ProgressionService } from '../../services/progression-service.js';

import type { XPSource, LevelUpInput } from '../../types/progression.js';

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

      const { xp, source, description, sessionId } = body as {
        xp: number;
        source: XPSource;
        description?: string;
        sessionId?: string;
      };

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
  })

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
  })

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

      const input = body as Omit<LevelUpInput, 'characterId'>;
      const result = await ProgressionService.levelUp({
        characterId: params.id,
        ...input,
      }, userId);

      return result;
    } catch (error) {
      logger.error({ msg: 'PROGRESSION_LEVELUP error', error });
      return mapProgressionError(set, error, 'Failed to level up');
    }
  })

  /**
   * GET /v1/progression/characters/:id/level-up-options
   * Get available options for leveling up
   */
  .get('/characters/:id/level-up-options', async ({ params, query, set, user }) => {
    try {
      const { newLevel } = query as { newLevel?: string };

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
  })

  /**
   * GET /v1/progression/characters/:id/experience-history
   * Get XP history for a character
   */
  .get('/characters/:id/experience-history', async ({ params, query, set, user }) => {
    try {
      const { sessionId, limit } = query as { sessionId?: string; limit?: string };

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
  })

  /**
   * POST /v1/progression/characters/:id/milestone-level
   * Set character level directly (milestone leveling)
   */
  .post('/characters/:id/milestone-level', async ({ params, body, set, user }) => {
    try {
      const { level, reason } = body as { level: number; reason?: string };

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
  })

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
