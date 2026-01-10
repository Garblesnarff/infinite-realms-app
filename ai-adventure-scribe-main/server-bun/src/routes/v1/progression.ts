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
 */

import { Elysia } from 'elysia';
import { authenticateRequest } from '../../lib/auth.js';
import { logger } from '../../lib/logger.js';
import { supabaseService } from '../../lib/supabase.js';

// Import service from Bun server
import { ProgressionService } from '../../services/progression-service.js';
import type { XPSource, LevelUpInput } from '../../types/progression.js';

/**
 * Helper to verify character ownership
 */
async function verifyCharacterOwnership(
  characterId: string,
  userId: string
): Promise<{ success: true } | { success: false; status: number; error: string }> {
  const { data: character, error: charErr } = await supabaseService
    .from('characters')
    .select('user_id')
    .eq('id', characterId)
    .single();

  if (charErr || !character) {
    return { success: false, status: 404, error: 'Character not found' };
  }

  if (character.user_id !== userId) {
    return { success: false, status: 403, error: 'Access denied' };
  }

  return { success: true };
}

export const progressionRoutes = new Elysia({ prefix: '/v1/progression' })

  /**
   * POST /v1/progression/characters/:id/experience/award
   * Award experience points to a character
   */
  .post('/characters/:id/experience/award', async ({ request, params, body, set }) => {
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

      const { xp, source, description, sessionId } = body as {
        xp: number;
        source: XPSource;
        description?: string;
        sessionId?: string;
      };

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
        description,
        sessionId
      );

      return result;
    } catch (error) {
      logger.error({ msg: 'PROGRESSION_AWARD_XP error', error });
      set.status = 500;
      return {
        error: 'Failed to award XP',
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  })

  /**
   * GET /v1/progression/characters/:id/progression
   * Get character's current progression status
   */
  .get('/characters/:id/progression', async ({ request, params, set }) => {
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

      const progression = await ProgressionService.getProgression(params.id);
      return progression;
    } catch (error) {
      logger.error({ msg: 'PROGRESSION_GET error', error });
      set.status = 500;
      return {
        error: 'Failed to get progression',
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  })

  /**
   * POST /v1/progression/characters/:id/level-up
   * Perform a level-up
   */
  .post('/characters/:id/level-up', async ({ request, params, body, set }) => {
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

      // Check if character can level up
      const canLevel = await ProgressionService.canLevelUp(params.id);
      if (!canLevel) {
        set.status = 400;
        return { error: 'Character does not have enough XP to level up' };
      }

      const input = body as Omit<LevelUpInput, 'characterId'>;
      const result = await ProgressionService.levelUp({
        characterId: params.id,
        ...input,
      });

      return result;
    } catch (error) {
      logger.error({ msg: 'PROGRESSION_LEVELUP error', error });
      set.status = 500;
      return {
        error: 'Failed to level up',
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  })

  /**
   * GET /v1/progression/characters/:id/level-up-options
   * Get available options for leveling up
   */
  .get('/characters/:id/level-up-options', async ({ request, params, query, set }) => {
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

      const options = await ProgressionService.getLevelUpOptions(params.id, level);
      return options;
    } catch (error) {
      logger.error({ msg: 'PROGRESSION_LEVELUP_OPTIONS error', error });
      set.status = 500;
      return {
        error: 'Failed to get level-up options',
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  })

  /**
   * GET /v1/progression/characters/:id/experience-history
   * Get XP history for a character
   */
  .get('/characters/:id/experience-history', async ({ request, params, query, set }) => {
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

      const { sessionId, limit } = query as { sessionId?: string; limit?: string };

      const events = await ProgressionService.getXPHistory(
        params.id,
        sessionId,
        limit ? parseInt(limit) : undefined
      );

      return { events };
    } catch (error) {
      logger.error({ msg: 'PROGRESSION_HISTORY error', error });
      set.status = 500;
      return {
        error: 'Failed to get XP history',
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  })

  /**
   * POST /v1/progression/characters/:id/milestone-level
   * Set character level directly (milestone leveling)
   */
  .post('/characters/:id/milestone-level', async ({ request, params, body, set }) => {
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

      const { level, reason } = body as { level: number; reason?: string };

      if (level === undefined || level < 1 || level > 20) {
        set.status = 400;
        return { error: 'Level must be between 1 and 20' };
      }

      const result = await ProgressionService.setLevel(params.id, level, reason);
      return result;
    } catch (error) {
      logger.error({ msg: 'PROGRESSION_MILESTONE error', error });
      set.status = 500;
      return {
        error: 'Failed to set milestone level',
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  })

  /**
   * GET /v1/progression/xp-table
   * Get the D&D 5E XP threshold table
   */
  .get('/xp-table', async ({ request, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const xpTable = ProgressionService.getXPTable();
      return { xpTable };
    } catch (error) {
      logger.error({ msg: 'PROGRESSION_XPTABLE error', error });
      set.status = 500;
      return {
        error: 'Failed to get XP table',
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
