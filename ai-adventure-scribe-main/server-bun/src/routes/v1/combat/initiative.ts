/* eslint-disable max-lines -- one cohesive encounter-lifecycle router. */
import { Elysia, t } from 'elysia';

import { verifyEncounterOwnership as defaultVerifyEncounterOwnership } from './helpers.js';
import { authenticateRequest as defaultAuthenticateRequest } from '../../../lib/auth.js';
import { AppError } from '../../../lib/errors.js';
import { logger as defaultLogger } from '../../../lib/logger.js';
import { CombatEncounterService as DefaultCombatEncounterService } from '../../../services/combat/combat-encounter-service.js';
import { concludeEncounter as defaultConcludeEncounter } from '../../../services/combat/combat-ending.js';
import { trackCombatEvent as defaultTrackCombatEvent } from '../../../services/combat/combat-events.js';
import { publishCombatState as defaultPublishCombatState } from '../../../services/combat/combat-sync-service.js';
import { buildInitiativeOrder as defaultBuildInitiativeOrder } from '../../../services/combat/initiative-order.js';
import { resetTacticalMovementForTurn as defaultResetTacticalMovementForTurn } from '../../../services/combat/tactical-combat-lifecycle.js';
import { CombatInitiativeService as DefaultCombatInitiativeService } from '../../../services/combat-initiative-service.js';

import type { CombatEndReason } from '../../../types/combat.js';

/**
 * The two client-facing terminations, funnelled.
 *
 * Both used to hand-assemble their own ending — end the row, tear down the board, emit an
 * event, republish — and both left out the one thing that turned out to matter: a sentence in
 * the DM's next context saying the fight had stopped. `concludeEncounter` is now the only
 * thing that ends an encounter, so neither can drift out of step with the resolved ending
 * again, and neither can reach `completed` without a reason.
 *
 * The encounter row is re-read afterwards because these endpoints have always answered with
 * it, and it now carries `endedReason` for the caller to see.
 */
async function endEncounterThroughFunnel(
  encounterId: string,
  sessionId: string | undefined,
  userId: string,
  reason: CombatEndReason,
  dependencies: Pick<InitiativeRouteOptions, 'combatEncounterService' | 'concludeEncounter'> = {},
) {
  const combatEncounterService =
    dependencies.combatEncounterService ?? DefaultCombatEncounterService;
  const concludeEncounter = dependencies.concludeEncounter ?? defaultConcludeEncounter;
  const session =
    sessionId ??
    (await combatEncounterService.getEncounterById(encounterId, userId))?.sessionId ??
    '';
  await concludeEncounter(encounterId, session, userId, reason);
  return combatEncounterService.getEncounterById(encounterId, userId);
}

const sessionIdParams = t.Object({
  sessionId: t.String({ minLength: 1, maxLength: 255 }),
});

const encounterIdParams = t.Object({
  encounterId: t.String({ minLength: 1, maxLength: 255 }),
});

const participantIdSchema = t.Object({
  participantId: t.String({ minLength: 1, maxLength: 255 }),
});

function mapCombatError(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  set: any,
  error: unknown,
  fallbackMessage: string,
  notFoundMessage: string = 'Not found',
) {
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

export interface InitiativeRouteOptions {
  authenticateRequest?: typeof defaultAuthenticateRequest;
  verifyEncounterOwnership?: typeof defaultVerifyEncounterOwnership;
  logger?: typeof defaultLogger;
  combatEncounterService?: typeof DefaultCombatEncounterService;
  concludeEncounter?: typeof defaultConcludeEncounter;
  trackCombatEvent?: typeof defaultTrackCombatEvent;
  publishCombatState?: typeof defaultPublishCombatState;
  buildInitiativeOrder?: typeof defaultBuildInitiativeOrder;
  resetTacticalMovementForTurn?: typeof defaultResetTacticalMovementForTurn;
  combatInitiativeService?: typeof DefaultCombatInitiativeService;
}

export function createInitiativeRoutes({
  authenticateRequest = defaultAuthenticateRequest,
  verifyEncounterOwnership = defaultVerifyEncounterOwnership,
  logger = defaultLogger,
  combatEncounterService = DefaultCombatEncounterService,
  concludeEncounter,
  trackCombatEvent = defaultTrackCombatEvent,
  publishCombatState = defaultPublishCombatState,
  buildInitiativeOrder = defaultBuildInitiativeOrder,
  resetTacticalMovementForTurn = defaultResetTacticalMovementForTurn,
  combatInitiativeService = DefaultCombatInitiativeService,
}: InitiativeRouteOptions = {}) {
  return (
    new Elysia()
      /**
       * POST /v1/combat/sessions/:sessionId/start
       * Retired in favor of the server-authoritative `/enter` handoff.
       */
      .post(
        '/sessions/:sessionId/start',
        async ({ request, set }) => {
          const { user, error: authError } = await authenticateRequest(request);
          if (authError || !user) {
            set.status = 401;
            return { error: authError || 'Unauthorized' };
          }

          set.status = 410;
          return {
            error: 'Combat start endpoint retired; use /v1/combat/sessions/:sessionId/enter',
          };
        },
        { params: sessionIdParams },
      )

      /**
       * POST /v1/combat/:encounterId/roll-initiative
       * Roll initiative for a participant
       */
      .post(
        '/:encounterId/roll-initiative',
        async ({ request, params, body, set }) => {
          const { user, error: authError } = await authenticateRequest(request);
          if (authError || !user) {
            set.status = 401;
            return { error: authError || 'Unauthorized' };
          }

          try {
            const verification = await verifyEncounterOwnership(params.encounterId, user.userId);
            if (!verification.success) {
              set.status = verification.error!.status;
              return { error: verification.error!.message };
            }

            const { participantId } = body;

            if (!participantId) {
              set.status = 400;
              return { error: 'participantId is required' };
            }

            const result = await combatInitiativeService.rollInitiative(
              params.encounterId,
              participantId,
              undefined,
              undefined,
              user.userId,
            );

            trackCombatEvent('initiative_completed', {
              encounterId: params.encounterId,
              participantId,
            });
            await publishCombatState(params.encounterId, user.userId, 'initiative_completed');

            return result;
          } catch (e) {
            logger.error({ msg: 'Roll initiative error', error: e });
            return mapCombatError(
              set,
              e,
              'Failed to roll initiative',
              'Combat participant not found',
            );
          }
        },
        { params: encounterIdParams, body: participantIdSchema },
      )

      /**
       * POST /v1/combat/:encounterId/next-turn
       * Advance to the next turn
       */
      .post(
        '/:encounterId/next-turn',
        async ({ request, params, set }) => {
          const { user, error: authError } = await authenticateRequest(request);
          if (authError || !user) {
            set.status = 401;
            return { error: authError || 'Unauthorized' };
          }

          try {
            const verification = await verifyEncounterOwnership(params.encounterId, user.userId);
            if (!verification.success) {
              set.status = verification.error!.status;
              return { error: verification.error!.message };
            }

            const result = await combatInitiativeService.advanceTurn(
              params.encounterId,
              user.userId,
            );
            if (verification.session)
              await resetTacticalMovementForTurn(
                verification.session.id,
                result.currentParticipant.id,
              );
            await publishCombatState(params.encounterId, user.userId, 'turn_advanced');
            return result;
          } catch (e) {
            logger.error({ msg: 'Advance turn error', error: e });
            return mapCombatError(set, e, 'Failed to advance turn', 'Encounter not found');
          }
        },
        { params: encounterIdParams },
      )

      /**
       * POST /v1/combat/:encounterId/end
       * End a combat encounter
       */
      .post(
        '/:encounterId/end',
        async ({ request, params, set }) => {
          const { user, error: authError } = await authenticateRequest(request);
          if (authError || !user) {
            set.status = 401;
            return { error: authError || 'Unauthorized' };
          }

          try {
            const verification = await verifyEncounterOwnership(params.encounterId, user.userId);
            if (!verification.success) {
              set.status = verification.error!.status;
              return { error: verification.error!.message };
            }

            return await endEncounterThroughFunnel(
              params.encounterId,
              verification.session?.id,
              user.userId,
              'ended_by_request',
              { combatEncounterService, concludeEncounter },
            );
          } catch (e) {
            logger.error({ msg: 'End combat error', error: e });
            return mapCombatError(set, e, 'Failed to end combat encounter', 'Encounter not found');
          }
        },
        { params: encounterIdParams },
      )

      .post(
        '/:encounterId/abandon',
        async ({ request, params, set }) => {
          const { user, error: authError } = await authenticateRequest(request);
          if (authError || !user) {
            set.status = 401;
            return { error: authError || 'Unauthorized' };
          }
          try {
            const verification = await verifyEncounterOwnership(params.encounterId, user.userId);
            if (!verification.success) {
              set.status = verification.error!.status;
              return { error: verification.error!.message };
            }
            return await endEncounterThroughFunnel(
              params.encounterId,
              verification.session?.id,
              user.userId,
              'abandoned',
              { combatEncounterService, concludeEncounter },
            );
          } catch (e) {
            logger.error({ msg: 'Abandon combat error', error: e });
            return mapCombatError(
              set,
              e,
              'Failed to abandon combat encounter',
              'Encounter not found',
            );
          }
        },
        { params: encounterIdParams },
      )

      /**
       * GET /v1/combat/:encounterId/status
       * Get current combat state
       */
      .get(
        '/:encounterId/status',
        async ({ request, params, set }) => {
          const { user, error: authError } = await authenticateRequest(request);
          if (authError || !user) {
            set.status = 401;
            return { error: authError || 'Unauthorized' };
          }

          try {
            const verification = await verifyEncounterOwnership(params.encounterId, user.userId);
            if (!verification.success) {
              set.status = verification.error!.status;
              return { error: verification.error!.message };
            }

            const combatState = await combatEncounterService.getCombatState(
              params.encounterId,
              user.userId,
            );
            return {
              ...combatState,
              initiativeOrder: buildInitiativeOrder(combatState),
              pendingIntent: combatState.encounter.pendingIntent ?? null,
            };
          } catch (e) {
            logger.error({ msg: 'Get combat status error', error: e });
            return mapCombatError(set, e, 'Failed to get combat status', 'Encounter not found');
          }
        },
        { params: encounterIdParams },
      )
  );
}

export const initiativeRoutes = createInitiativeRoutes();
