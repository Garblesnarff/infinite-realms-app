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
  proposeCombatAttack,
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
    if (error.statusCode >= 500) return { error: 'Combat action failed' };
    // Details ride along on client-fixable answers. A refusal the caller cannot act on is a
    // refusal it will re-send verbatim: "Combat participant not found" says a reference missed,
    // and only the roster beside it says what to write instead.
    return { error: error.message, ...(error.details ? { details: error.details } : {}) };
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
        phase?: 'propose' | 'commit';
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
        // A proposal claims nothing and resolves nothing: it answers what the attack would be
        // so the player can roll their own die against real numbers. Routed here rather than
        // through a sibling endpoint so it inherits this route's authentication, ownership
        // check, and reference resolution unchanged — a proposal computed under looser rules
        // than the commit would be a proposal about a different attack.
        if (payload.phase === 'propose') {
          return {
            accepted: true,
            proposal: await proposeCombatAttack(
              params.encounterId,
              payload.intent,
              user.userId,
              payload.source === 'dm' ? 'dm' : 'player',
            ),
          };
        }
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
        // A session without combat is the expected result for this read. Keep
        // optional combat polling out of the error path and its 404 noise.
        return { combat: null, initiativeOrder: [], tacticalMap: null };
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
