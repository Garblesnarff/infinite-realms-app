import { Elysia, t } from 'elysia';

import { verifyEncounterOwnership, verifySessionOwnership } from './helpers.js';
import {
  combatIntentEnvelopeSchema,
  combatIntentRequestValidator,
  describeIntentRejection,
  type CombatActionOrigin,
} from './intent-schema.js';
import { authenticateRequest } from '../../../lib/auth.js';
import { AppError } from '../../../lib/errors.js';
import { logger } from '../../../lib/logger.js';
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
function mapIntentError(set: any, error: unknown, logContext: Record<string, unknown> = {}) {
  if (error instanceof AppError) {
    set.status = error.statusCode;
    if (error.statusCode >= 500) {
      logIntentFailure(error, logContext);
      return { error: 'Combat action failed' };
    }
    // A 4xx refusal used to leave no line, so the one a player saw had no reason code in the log
    // to match it against (#2374).
    logger.warn(
      {
        ...logContext,
        status: error.statusCode,
        reason: (error.details as { reason?: string } | undefined)?.reason,
        stage: (error.details as { stage?: string } | undefined)?.stage,
        err: error.message,
      },
      'COMBAT_INTENT_REFUSED',
    );
    // Details ride along on client-fixable answers. A refusal the caller cannot act on is a
    // refusal it will re-send verbatim: "Combat participant not found" says a reference missed,
    // and only the roster beside it says what to write instead.
    return { error: error.message, ...(error.details ? { details: error.details } : {}) };
  }
  set.status = 500;
  logIntentFailure(error, logContext);
  return { error: 'Combat action failed' };
}

/**
 * A 500 is the one answer the client cannot act on, and it used to leave no trace: run 13's
 * three spell-proposal 500s had only `request.start`/`request.end` in the log (#2303). Every
 * 5xx now leaves the thrown error beside the request id that surfaced it.
 */
function logIntentFailure(error: unknown, logContext: Record<string, unknown>): void {
  logger.error(
    {
      ...logContext,
      errName: error instanceof Error ? error.name : typeof error,
      errMessage: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    },
    'COMBAT_INTENT_FAILED',
  );
}

function requestIdOf(context: unknown, request: Request): string {
  const contextRequestId = (context as { requestId?: unknown }).requestId;
  return typeof contextRequestId === 'string'
    ? contextRequestId
    : request.headers.get('x-request-id') || 'unknown';
}

/**
 * #2569: one accepted-intent line with phase/source/origin and whether the
 * player supplied their own d20. No intent bodies, no user text.
 */
function logIntentAccepted(
  context: unknown,
  request: Request,
  params: { encounterId: string },
  payload: {
    intent?: { type: string; d20?: unknown };
    phase?: 'propose' | 'commit';
    source?: 'player' | 'dm';
    origin?: CombatActionOrigin;
  },
): void {
  logger.info(
    {
      requestId: requestIdOf(context, request),
      encounterId: params.encounterId,
      intentType: payload.intent?.type ?? 'unknown',
      phase: payload.phase ?? 'commit',
      source: payload.source ?? 'player',
      origin: payload.origin ?? null,
      d20Supplied: payload.intent?.d20 != null,
    },
    'COMBAT_INTENT_ACCEPTED',
  );
}

export const intentRoutes = new Elysia()
  .get(
    '/:encounterId/legal-actions',
    async (context) => {
      const { request, params, set } = context;
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
        const legalActions = await getLegalCombatActions(params.encounterId, user.userId);
        // #2569: one info line per legal-actions response with option-type counts.
        // Counts only — no bodies, no user text.
        const optionTypeCounts: Record<string, number> = {};
        for (const action of legalActions.actions) {
          const type = typeof action.type === 'string' ? action.type : 'unknown';
          optionTypeCounts[type] = (optionTypeCounts[type] ?? 0) + 1;
        }
        logger.info(
          {
            requestId: requestIdOf(context, request),
            encounterId: params.encounterId,
            actorId: legalActions.actorId,
            version: legalActions.version,
            optionTypeCounts,
            totalOptions: legalActions.actions.length,
          },
          'LEGAL_ACTIONS_SERVED',
        );
        return legalActions;
      } catch (cause) {
        return mapIntentError(set, cause, {
          requestId: requestIdOf(context, request),
          encounterId: params.encounterId,
        });
      }
    },
    { params: encounterIdParams },
  )
  .post(
    '/:encounterId/intent',
    async (context) => {
      const { request, params, body, set } = context;
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
        origin?: CombatActionOrigin;
      };
      if (!payload.intent?.type || !payload.intent.actorId) {
        set.status = 400;
        return { error: 'A typed combat intent with actorId is required' };
      }
      // --- Bad payload: 422 naming the variant that refused it, before any work happens. ---
      if (!combatIntentRequestValidator?.Check(payload)) {
        const rejection = describeIntentRejection(payload);
        const requestId = requestIdOf(context, request);
        // #2427: a type that matches no variant is client text; the log keeps its first 32 chars.
        const sentType = String(payload.intent.type);
        const loggedDetail = rejection.variant
          ? rejection.detail
          : rejection.detail.replace(JSON.stringify(sentType), () =>
              JSON.stringify(sentType.slice(0, 32)),
            );
        logger.warn(
          {
            requestId,
            field: rejection.missing[0] ?? (rejection.variant ? 'intent' : 'intent.type'),
            reason: loggedDetail,
          },
          'COMBAT_INTENT_SCHEMA_REJECTED',
        );
        set.status = 422;
        return rejection;
      }
      try {
        // A proposal claims nothing and resolves nothing: it answers what the attack would be
        // so the player can roll their own die against real numbers. Routed here rather than
        // through a sibling endpoint so it inherits this route's authentication, ownership
        // check, and reference resolution unchanged — a proposal computed under looser rules
        // than the commit would be a proposal about a different attack.
        if (payload.phase === 'propose') {
          const proposal = await proposeCombatAttack(
            params.encounterId,
            payload.intent,
            user.userId,
            payload.source === 'dm' ? 'dm' : 'player',
          );
          logIntentAccepted(context, request, params, payload);
          return { accepted: true, proposal };
        }
        const result = await executeCombatIntent(
          params.encounterId,
          payload.intent,
          user.userId,
          payload.source === 'dm' ? 'dm' : 'player',
          payload.dmStartedAt,
          payload.origin,
        );
        logIntentAccepted(context, request, params, payload);
        return {
          accepted: true,
          result,
          engineRows: (result as { engineRows?: unknown }).engineRows ?? [],
        };
      } catch (cause) {
        return mapIntentError(set, cause, {
          requestId: requestIdOf(context, request),
          encounterId: params.encounterId,
          intentType: payload.intent.type,
          phase: payload.phase ?? 'commit',
          source: payload.source ?? 'player',
          origin: payload.origin ?? null,
        });
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
