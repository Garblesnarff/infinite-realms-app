/**
 * Rest Routes (Elysia/Bun)
 *
 * REST endpoints for D&D 5E rest mechanics:
 * - Short rests (1 hour, spend hit dice)
 * - Long rests (8 hours, full restoration)
 * - Hit dice management
 *
 * Ported from /server/src/routes/v1/rest.ts
 */

import { Elysia } from 'elysia';
import { authenticateRequest } from '../../lib/auth.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { verifySessionOwnership } from './combat/helpers.js';

// Import service from Bun server
import { CharacterService } from '../../services/character-service.js';
import { RestService } from '../../services/rest-service.js';

/**
 * Helper to verify character ownership
 */
async function verifyCharacterOwnership(
  characterId: string,
  userId: string
): Promise<{ success: true } | { success: false; status: number; error: string }> {
  const character = await CharacterService.getById(characterId, userId);
  if (!character) {
    return { success: false, status: 404, error: 'Character not found' };
  }
  return { success: true };
}

function mapRestError(
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

export const restRoutes = new Elysia({ prefix: '/v1/rest' })

  /**
   * POST /v1/rest/characters/:id/short
   * Take a short rest
   */
  .post('/characters/:id/short', async ({ request, params, body, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const ownership = await verifyCharacterOwnership(params.id, user.userId);
      if (ownership.success === false) {
        set.status = ownership.status;
        return { error: ownership.error };
      }

      const { hitDiceToSpend, sessionId, notes } = body as {
        hitDiceToSpend?: number;
        sessionId?: string;
        notes?: string;
      };

      if (sessionId) {
        const verification = await verifySessionOwnership(sessionId, user.userId);
        if (!verification.success) {
          set.status = verification.error!.status;
          return { error: verification.error!.message };
        }
      }

      const result = await RestService.takeShortRest(
        params.id,
        hitDiceToSpend || 0,
        sessionId,
        notes,
        user.userId
      );

      return result;
    } catch (error) {
      logger.error({ msg: 'REST_SHORT error', error });
      return mapRestError(set, error, 'Failed to complete short rest');
    }
  })

  /**
   * POST /v1/rest/characters/:id/long
   * Take a long rest (8 hours, restore all HP, spell slots, and half hit dice)
   */
  .post('/characters/:id/long', async ({ request, params, body, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const ownership = await verifyCharacterOwnership(params.id, user.userId);
      if (ownership.success === false) {
        set.status = ownership.status;
        return { error: ownership.error };
      }

      const { sessionId, notes } = body as {
        sessionId?: string;
        notes?: string;
      };

      if (sessionId) {
        const verification = await verifySessionOwnership(sessionId, user.userId);
        if (!verification.success) {
          set.status = verification.error!.status;
          return { error: verification.error!.message };
        }
      }

      const result = await RestService.takeLongRest(params.id, sessionId, notes, user.userId);
      return result;
    } catch (error) {
      logger.error({ msg: 'REST_LONG error', error });
      return mapRestError(set, error, 'Failed to complete long rest');
    }
  })

  /**
   * GET /v1/rest/characters/:id/hit-dice
   * Get all hit dice for a character
   */
  .get('/characters/:id/hit-dice', async ({ request, params, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const ownership = await verifyCharacterOwnership(params.id, user.userId);
      if (ownership.success === false) {
        set.status = ownership.status;
        return { error: ownership.error };
      }

      const hitDice = await RestService.getHitDice(params.id, user.userId);
      return { hitDice };
    } catch (error) {
      logger.error({ msg: 'REST_HITDICE_GET error', error });
      return mapRestError(set, error, 'Failed to get hit dice');
    }
  })

  /**
   * POST /v1/rest/characters/:id/hit-dice/spend
   * Spend hit dice to recover HP
   */
  .post('/characters/:id/hit-dice/spend', async ({ request, params, body, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const ownership = await verifyCharacterOwnership(params.id, user.userId);
      if (ownership.success === false) {
        set.status = ownership.status;
        return { error: ownership.error };
      }

      const { count, roll } = body as {
        count: number;
        roll?: number;
      };

      if (!count || count < 1) {
        set.status = 400;
        return { error: 'Count must be at least 1' };
      }

      const result = await RestService.spendHitDice(
        params.id,
        count,
        roll ? [roll] : undefined,
        user.userId
      );

      return {
        hpRestored: result.hpRestored,
        hitDiceSpent: result.hitDiceSpent,
        rolls: result.rolls,
        remaining: result.hitDiceRemaining,
      };
    } catch (error) {
      logger.error({ msg: 'REST_HITDICE_SPEND error', error });
      return mapRestError(set, error, 'Failed to spend hit dice');
    }
  })

  /**
   * GET /v1/rest/characters/:id/rest-history
   * Get rest history for a character
   */
  .get('/characters/:id/rest-history', async ({ request, params, query, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const ownership = await verifyCharacterOwnership(params.id, user.userId);
      if (ownership.success === false) {
        set.status = ownership.status;
        return { error: ownership.error };
      }

      const { sessionId, limit } = query as { sessionId?: string; limit?: string };

      if (sessionId) {
        const verification = await verifySessionOwnership(sessionId, user.userId);
        if (!verification.success) {
          set.status = verification.error!.status;
          return { error: verification.error!.message };
        }
      }

      const rests = await RestService.getRestHistory(
        params.id,
        sessionId,
        limit ? parseInt(limit) : undefined,
        user.userId
      );

      return { rests };
    } catch (error) {
      logger.error({ msg: 'REST_HISTORY error', error });
      return mapRestError(set, error, 'Failed to get rest history');
    }
  })

  /**
   * POST /v1/rest/characters/:id/hit-dice/initialize
   * Initialize hit dice for a character (used when creating/leveling character)
   */
  .post('/characters/:id/hit-dice/initialize', async ({ request, params, body, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const ownership = await verifyCharacterOwnership(params.id, user.userId);
      if (ownership.success === false) {
        set.status = ownership.status;
        return { error: ownership.error };
      }

      const { className, level } = body as {
        className: string;
        level: number;
      };

      if (!className || !level || level < 1 || level > 20) {
        set.status = 400;
        return { error: 'Valid className and level (1-20) are required' };
      }

      const hitDice = await RestService.initializeHitDice(params.id, className, level, user.userId);

      set.status = 201;
      return { hitDice };
    } catch (error) {
      logger.error({ msg: 'REST_HITDICE_INIT error', error });
      return mapRestError(set, error, 'Failed to initialize hit dice');
    }
  });
