/* eslint-disable @typescript-eslint/no-explicit-any */
// Hit-dice/history extras (GET hit-dice, POST hit-dice/spend, GET
// rest-history, POST hit-dice/initialize) were removed in the 2026-07-22
// dead-code sweep — zero frontend/e2e/test callers. Short/long rest remain
// live (called from src/services/rest-api.ts).
import { Elysia, t } from 'elysia';

import { verifySessionOwnership } from './combat/helpers.js';
import { type AuthUser } from '../../lib/auth.js';
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

function mapRestError(
  set: any,
  error: unknown,
  fallbackMessage: string,
  notFoundMessage: string = 'Not found',
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
  .use(requireAuth)
  /**
   * Centralized character ownership verification
   */
  // ⚠️ Must be .resolve(), not .derive(): Elysia runs derive() in the
  // transform phase, before resolve() (which requireAuth uses) populates
  // `user` in beforeHandle. A derive() here always sees user === undefined,
  // so the ownership fetch is silently skipped and every /:id request 404s.
  .resolve(async ({ user, params }) => {
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
  );
