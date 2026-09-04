import { Elysia, t } from 'elysia';

import { authenticateRequest as defaultAuthenticateRequest } from '../../../lib/auth.js';
import { AppError } from '../../../lib/errors.js';
import {
  clearPendingCombatIntent as defaultClearPendingCombatIntent,
  promotePendingCombatIntent as defaultPromotePendingCombatIntent,
  setPendingCombatIntent as defaultSetPendingCombatIntent,
  type PendingCombatIntentInput,
} from '../../../services/combat/combat-pending-intent-service.js';
import { publishCombatState as defaultPublishCombatState } from '../../../services/combat/combat-sync-service.js';

import type { PendingCombatIntent } from '../../../../../db/schema/index';

const encounterIdParams = t.Object({
  encounterId: t.String({ minLength: 1, maxLength: 255 }),
});

const pendingIntentBody = t.Object({
  actorId: t.String({ minLength: 1, maxLength: 255 }),
  actionType: t.String({ minLength: 1, maxLength: 100 }),
  targetIds: t.Array(t.String({ minLength: 1, maxLength: 255 }), { maxItems: 100 }),
  sourceText: t.String({ minLength: 1, maxLength: 10_000 }),
});

function mapPendingIntentError(
  set: { status?: number | string },
  error: unknown,
): { error: string; details?: unknown } {
  if (error instanceof AppError) {
    set.status = error.statusCode;
    return {
      error: error.statusCode === 404 ? 'Encounter not found' : error.message,
      ...(error.details ? { details: error.details } : {}),
    };
  }
  set.status = 500;
  return { error: 'Failed to save pending combat intent' };
}

export interface PendingIntentRouteOptions {
  authenticateRequest?: typeof defaultAuthenticateRequest;
  setPendingCombatIntent?: typeof defaultSetPendingCombatIntent;
  clearPendingCombatIntent?: typeof defaultClearPendingCombatIntent;
  promotePendingCombatIntent?: typeof defaultPromotePendingCombatIntent;
  publishCombatState?: typeof defaultPublishCombatState;
}

export function createPendingIntentRoutes({
  authenticateRequest = defaultAuthenticateRequest,
  setPendingCombatIntent = defaultSetPendingCombatIntent,
  clearPendingCombatIntent = defaultClearPendingCombatIntent,
  promotePendingCombatIntent = defaultPromotePendingCombatIntent,
  publishCombatState = defaultPublishCombatState,
}: PendingIntentRouteOptions = {}) {
  return new Elysia()
    .patch(
      '/:encounterId/pending-intent',
      async ({ request, params, body, set }) => {
        const { user, error: authError } = await authenticateRequest(request);
        if (authError || !user) {
          set.status = 401;
          return { error: authError || 'Unauthorized' };
        }

        try {
          const pendingIntent = await setPendingCombatIntent(
            params.encounterId,
            body as PendingCombatIntentInput,
            user.userId,
          );
          await publishCombatState(params.encounterId, user.userId, 'pending_intent_updated');
          return { pendingIntent } satisfies { pendingIntent: PendingCombatIntent };
        } catch (error) {
          return mapPendingIntentError(set, error);
        }
      },
      { params: encounterIdParams, body: pendingIntentBody },
    )
    .delete(
      '/:encounterId/pending-intent',
      async ({ request, params, set }) => {
        const { user, error: authError } = await authenticateRequest(request);
        if (authError || !user) {
          set.status = 401;
          return { error: authError || 'Unauthorized' };
        }

        try {
          await clearPendingCombatIntent(params.encounterId, user.userId);
          await publishCombatState(params.encounterId, user.userId, 'pending_intent_updated');
          return { pendingIntent: null };
        } catch (error) {
          return mapPendingIntentError(set, error);
        }
      },
      { params: encounterIdParams },
    )
    .post(
      '/:encounterId/pending-intent/promote',
      async ({ request, params, set }) => {
        const { user, error: authError } = await authenticateRequest(request);
        if (authError || !user) {
          set.status = 401;
          return { error: authError || 'Unauthorized' };
        }

        try {
          const pendingIntent = await promotePendingCombatIntent(params.encounterId, user.userId);
          await publishCombatState(params.encounterId, user.userId, 'pending_intent_updated');
          return { pendingIntent } satisfies { pendingIntent: PendingCombatIntent };
        } catch (error) {
          return mapPendingIntentError(set, error);
        }
      },
      { params: encounterIdParams },
    );
}

export const pendingIntentRoutes = createPendingIntentRoutes();
