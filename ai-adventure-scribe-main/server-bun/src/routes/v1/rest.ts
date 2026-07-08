/* eslint-disable max-lines */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Elysia, t } from 'elysia';

import { verifySessionOwnership } from './combat/helpers.js';
import type { AuthUser } from '../../lib/auth.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { requireAuth } from '../../middleware/auth.js';
import { CharacterService } from '../../services/character-service.js';
import { RestService } from '../../services/rest-service.js';

const shortRestSchema = t.Object({
  hitDiceToSpend: t.Optional(t.Number({ minimum: 0 })),
  sessionId: t.Optional(t.String()),
  notes: t.Optional(t.String()),
});
const longRestSchema = t.Object({
  sessionId: t.Optional(t.String()),
  notes: t.Optional(t.String()),
});
const spendHitDiceSchema = t.Object({
  count: t.Number({ minimum: 1 }),
  roll: t.Optional(t.Number({ minimum: 1, maximum: 12 })),
});
const initializeHitDiceSchema = t.Object({
  className: t.String({ minLength: 1 }),
  level: t.Number({ minimum: 1, maximum: 20 }),
});

function mapRestError(
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

export const restRoutes = new Elysia({ prefix: '/v1/rest' })
  /**
   * Centralized authentication and character ownership verification
   */
  .use(requireAuth)
  .derive(async ({ user, params }) => {
    let character = null;
    if (user && params?.id) {
      // 🛡️ Sentinel: Fetch character once in derive block to avoid double-fetching.
      // CharacterService.getById verifies dual-ownership (userId OR ownerId).
      character = await CharacterService.getById(params.id, user.userId);
    }

    return { character };
  })
  .onBeforeHandle(async ({ params, character, set }) => {
    if (params?.id && !character) {
      // 🛡️ Sentinel: Return 404 for unauthorized access to prevent existence leakage.
      set.status = 404;
      return { error: 'Character not found' };
    }
  })

  /**
   * POST /v1/rest/characters/:id/short
   * Take a short rest
   */
  .post(
    '/characters/:id/short',
    async ({ params, body, set, user }) => {
      try {
        const { hitDiceToSpend, sessionId, notes } = body;
        const userId = (user as AuthUser).userId;

        if (sessionId) {
          const verification = await verifySessionOwnership(sessionId, userId);
          if (!verification.success) {
            set.status = verification.error?.status || 404;
            return { error: verification.error?.message || 'Session not found' };
          }
        }

        const result = await RestService.takeShortRest(
          params.id,
          userId,
          hitDiceToSpend || 0,
          sessionId,
          notes,
        );

        return result;
      } catch (error) {
        logger.error({ msg: 'REST_SHORT error', error });
        return mapRestError(set, error, 'Failed to complete short rest');
      }
    },
    {
      body: shortRestSchema,
    },
  )

  /**
   * POST /v1/rest/characters/:id/long
   * Take a long rest (8 hours, restore all HP, spell slots, and half hit dice)
   */
  .post(
    '/characters/:id/long',
    async ({ params, body, set, user }) => {
      try {
        const { sessionId, notes } = body;
        const userId = (user as AuthUser).userId;

        // Verify session ownership for long rests to prevent IDOR.
        if (sessionId) {
          const verification = await verifySessionOwnership(sessionId, userId);
          if (!verification.success) {
            set.status = verification.error?.status || 404;
            return { error: verification.error?.message || 'Session not found' };
          }
        }

        const result = await RestService.takeLongRest(params.id, userId, sessionId, notes);
        return result;
      } catch (error) {
        logger.error({ msg: 'REST_LONG error', error });
        return mapRestError(set, error, 'Failed to complete long rest');
      }
    },
    {
      body: longRestSchema,
    },
  )

  /**
   * GET /v1/rest/characters/:id/hit-dice
   * Get all hit dice for a character
   */
  .get('/characters/:id/hit-dice', async ({ params, set, user }) => {
    try {
      const hitDice = await RestService.getHitDice(params.id, (user as { userId: string }).userId);
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
  .post(
    '/characters/:id/hit-dice/spend',
    async ({ params, body, set, user }) => {
      try {
        const { count, roll } = body;
        const userId = (user as AuthUser).userId;

        const result = await RestService.spendHitDice(
          params.id,
          userId,
          count,
          roll ? [roll] : undefined,
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
    },
    {
      body: spendHitDiceSchema,
    },
  )

  /**
   * GET /v1/rest/characters/:id/rest-history
   * Get rest history for a character
   */
  .get(
    '/characters/:id/rest-history',
    async ({ params, query, set, user }) => {
      try {
        const { sessionId, limit } = query;
        const userId = (user as AuthUser).userId;

        if (sessionId) {
          const verification = await verifySessionOwnership(sessionId, userId);
          if (!verification.success) {
            set.status = verification.error?.status || 404;
            return { error: verification.error?.message || 'Session not found' };
          }
        }

        const rests = await RestService.getRestHistory(
          params.id,
          userId,
          sessionId,
          limit ? parseInt(limit) : undefined,
        );

        return { rests };
      } catch (error) {
        logger.error({ msg: 'REST_HISTORY error', error });
        return mapRestError(set, error, 'Failed to get rest history');
      }
    },
    {
      query: t.Object({
        sessionId: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    },
  )

  /**
   * POST /v1/rest/characters/:id/hit-dice/initialize
   * Initialize hit dice for a character (used when creating/leveling character)
   */
  .post(
    '/characters/:id/hit-dice/initialize',
    async ({ params, body, set, user }) => {
      try {
        const { className, level } = body;
        const userId = (user as AuthUser).userId;

        const hitDice = await RestService.initializeHitDice(params.id, userId, className, level);

        set.status = 201;
        return { hitDice };
      } catch (error) {
        logger.error({ msg: 'REST_HITDICE_INIT error', error });
        return mapRestError(set, error, 'Failed to initialize hit dice');
      }
    },
    {
      body: initializeHitDiceSchema,
    },
  );
