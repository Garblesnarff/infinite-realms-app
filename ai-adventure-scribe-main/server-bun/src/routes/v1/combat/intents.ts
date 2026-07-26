import { Elysia, t } from 'elysia';

import { verifyEncounterOwnership, verifySessionOwnership } from './helpers.js';
import {
  combatIntentEnvelopeSchema,
  combatIntentRequestValidator,
  describeIntentRejection,
} from './intent-schema.js';
import { authenticateRequest } from '../../../lib/auth.js';
import { AppError } from '../../../lib/errors.js';
import { CombatEncounterService } from '../../../services/combat/combat-encounter-service.js';
import {
  executeCombatIntent,
  getLegalCombatActions,
  type SubmittedCombatIntent,
} from '../../../services/combat/combat-intent-service.js';
import { buildInitiativeOrder } from '../../../services/combat/initiative-order.js';
import { loadActiveTacticalMap } from '../../../services/combat/tactical-map-store.js';

const encounterIdParams = t.Object({
  encounterId: t.String({ minLength: 1, maxLength: 255 }),
});

const sessionIdParams = t.Object({
  sessionId: t.String({ minLength: 1, maxLength: 255 }),
});

// Elysia's status union is intentionally framework-owned and wider than a simple number.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapIntentError(set: any, error: unknown) {
  if (error instanceof AppError) {
    set.status = error.statusCode;
    return { error: error.statusCode >= 500 ? 'Combat action failed' : error.message };
  }
  set.status = 500;
  return { error: 'Combat action failed' };
}

export const intentRoutes = new Elysia()
  .get(
    '/:encounterId/legal-actions',
    async ({ request, params, set }) => {
      const { user, error } = await authenticateRequest(request);
      if (error || !user) {
        set.status = 401;
        return { error: error || 'Unauthorized' };
      }
      const access = await verifyEncounterOwnership(params.encounterId, user.userId);
      if (!access.success) {
        set.status = access.error!.status;
        return { error: access.error!.message };
      }
      try {
        return await getLegalCombatActions(params.encounterId, user.userId);
      } catch (cause) {
        return mapIntentError(set, cause);
      }
    },
    { params: encounterIdParams },
  )
  .post(
    '/:encounterId/intent',
    async ({ request, params, body, set }) => {
      const { user, error } = await authenticateRequest(request);
      if (error || !user) {
        set.status = 401;
        return { error: error || 'Unauthorized' };
      }
      const access = await verifyEncounterOwnership(params.encounterId, user.userId);
      if (!access.success) {
        set.status = access.error!.status;
        return { error: access.error!.message };
      }
      // The envelope schema is deliberately untyped; `combatIntentRequestValidator` below is
      // what actually establishes this shape.
      const payload = body as {
        intent?: SubmittedCombatIntent;
        source?: 'player' | 'dm';
        dmStartedAt?: number;
      };
      if (!payload.intent?.type || !payload.intent.actorId) {
        set.status = 400;
        return { error: 'A typed combat intent with actorId is required' };
      }
      // --- Bad payload: 422 naming the variant that refused it, before any work happens. ---
      if (!combatIntentRequestValidator?.Check(payload)) {
        set.status = 422;
        return describeIntentRejection(payload);
      }
      try {
        const result = await executeCombatIntent(
          params.encounterId,
          payload.intent,
          user.userId,
          payload.source === 'dm' ? 'dm' : 'player',
          payload.dmStartedAt,
        );
        return { accepted: true, result };
      } catch (cause) {
        return mapIntentError(set, cause);
      }
    },
    { params: encounterIdParams, body: combatIntentEnvelopeSchema },
  )
  .get(
    '/sessions/:sessionId/active',
    async ({ request, params, set }) => {
      const { user, error } = await authenticateRequest(request);
      if (error || !user) {
        set.status = 401;
        return { error: error || 'Unauthorized' };
      }
      const access = await verifySessionOwnership(params.sessionId, user.userId);
      if (!access.success) {
        set.status = access.error!.status;
        return { error: access.error!.message };
      }
      const encounter = await CombatEncounterService.getActiveEncounter(
        params.sessionId,
        user.userId,
      );
      if (!encounter) {
        set.status = 404;
        return { error: 'No active combat encounter' };
      }
      const combat = await CombatEncounterService.getCombatState(encounter.id, user.userId);
      return {
        combat,
        initiativeOrder: buildInitiativeOrder(combat),
        tacticalMap: await loadActiveTacticalMap(params.sessionId),
      };
    },
    { params: sessionIdParams },
  );
