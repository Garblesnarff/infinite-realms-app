/* eslint-disable max-lines -- one cohesive encounter-lifecycle router. */
import { Elysia, t } from 'elysia';

import { verifyEncounterOwnership, verifySessionOwnership } from './helpers.js';
import { authenticateRequest } from '../../../lib/auth.js';
import { AppError } from '../../../lib/errors.js';
import { logger } from '../../../lib/logger.js';
import { CombatEncounterService } from '../../../services/combat/combat-encounter-service.js';
import { concludeEncounter } from '../../../services/combat/combat-ending.js';
import { trackCombatEvent } from '../../../services/combat/combat-events.js';
import { publishCombatState } from '../../../services/combat/combat-sync-service.js';
import { buildInitiativeOrder } from '../../../services/combat/initiative-order.js';
import { sanitizeSceneSpec } from '../../../services/combat/scene-spec-sanitizer.js';
import {
  createTacticalCombatMap,
  resetTacticalMovementForTurn,
} from '../../../services/combat/tactical-combat-lifecycle.js';
import { CombatInitiativeService } from '../../../services/combat-initiative-service.js';

import type { SceneSpec } from '../../../tactical/types.js';
import type { CombatEndReason, CreateParticipantInput } from '../../../types/combat.js';

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
) {
  const session =
    sessionId ??
    (await CombatEncounterService.getEncounterById(encounterId, userId))?.sessionId ??
    '';
  await concludeEncounter(encounterId, session, userId, reason);
  return CombatEncounterService.getEncounterById(encounterId, userId);
}

const sessionIdParams = t.Object({
  sessionId: t.String({ minLength: 1, maxLength: 255 }),
});

const encounterIdParams = t.Object({
  encounterId: t.String({ minLength: 1, maxLength: 255 }),
});

/**
 * Shape and bounds only. Required-field and value checks happen inside the handler so a bad
 * payload gets an honest `{error, stage, detail}` body — a TypeBox rejection is intercepted by
 * the global pipeline and flattened into an opaque `Internal Server Error`, which is exactly
 * the kind of blind failure this endpoint was suffering from.
 */
const startCombatSchema = t.Object({
  participants: t.Array(
    t.Object({
      encounterId: t.Optional(t.String({ maxLength: 255 })),
      characterId: t.Optional(t.Nullable(t.String({ minLength: 1, maxLength: 255 }))),
      npcId: t.Optional(t.Nullable(t.String({ minLength: 1, maxLength: 255 }))),
      // SRD catalog id from a structured DM combat start. Lookup key only, never a DB key.
      monsterId: t.Optional(t.Nullable(t.String({ minLength: 1, maxLength: 120 }))),
      name: t.Optional(t.String({ maxLength: 200 })),
      initiativeModifier: t.Optional(t.Number({ minimum: -100, maximum: 100 })),
      hpCurrent: t.Optional(t.Nullable(t.Number({ minimum: 0, maximum: 100_000 }))),
      hpMax: t.Optional(t.Nullable(t.Number({ minimum: 0, maximum: 100_000 }))),
    }),
    { maxItems: 100 },
  ),
  surpriseRound: t.Optional(t.Boolean()),
  // Tactical scene specs are produced by the structured DM response and have a separate validator.
  sceneSpec: t.Optional(t.Unknown()),
});

/** Returns a human-readable reason the participants array is unusable, or null. */
function participantsRejection(participants: unknown): string | null {
  if (!Array.isArray(participants) || participants.length === 0) {
    return 'participants must be a non-empty array';
  }
  for (const [index, participant] of participants.entries()) {
    const candidate = participant as { name?: unknown; initiativeModifier?: unknown };
    if (typeof candidate.name !== 'string' || !candidate.name.trim()) {
      return `participants[${index}].name is required`;
    }
    if (
      candidate.initiativeModifier !== undefined &&
      !Number.isFinite(candidate.initiativeModifier)
    ) {
      return `participants[${index}].initiativeModifier must be a number`;
    }
  }
  return null;
}

const participantIdSchema = t.Object({
  participantId: t.String({ minLength: 1, maxLength: 255 }),
});

const reorderInitiativeSchema = t.Object({
  participantId: t.String({ minLength: 1, maxLength: 255 }),
  newInitiative: t.Number({ minimum: -100, maximum: 100 }),
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

/**
 * Which step of the combat-start pipeline failed. Returned to the client so a 500 is
 * actionable instead of an opaque "Failed to start combat encounter", and so the headless
 * client can tell a bad payload apart from a broken server.
 */
export type CombatStartStage = 'ownership' | 'participants' | 'map_generation' | 'persistence';

class CombatStartStageError extends Error {
  constructor(
    readonly stage: CombatStartStage,
    readonly status: number,
    readonly detail: string,
    options?: { cause?: unknown },
  ) {
    super(`combat start failed at ${stage}: ${detail}`, options);
    this.name = 'CombatStartStageError';
  }
}

/**
 * Drizzle wraps driver failures as `Failed query: <sql>` and hangs the real database error
 * off `cause`, so the useful sentence is one level down. Both are reported.
 */
function describe(error: unknown, depth = 0): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as { cause?: unknown }).cause;
  if (depth >= 3 || !(cause instanceof Error)) return error.message;
  return `${error.message} (cause: ${describe(cause, depth + 1)})`;
}

/**
 * Runs one stage, tagging any escaping exception with the stage that produced it. AppErrors
 * keep their own status; everything else becomes a 500 for that stage.
 */
async function runStage<T>(stage: CombatStartStage, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (e) {
    if (e instanceof CombatStartStageError) throw e;
    const status = e instanceof AppError ? e.statusCode : 500;
    throw new CombatStartStageError(stage, status, describe(e), { cause: e });
  }
}

// Session ids are uuid columns: a non-uuid reaches Postgres as a cast failure (a 500 that
// reads like a server bug). Reject it as the bad request it is, before any query runs.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const initiativeRoutes = new Elysia()
  /**
   * POST /v1/combat/sessions/:sessionId/start
   * Start a new combat encounter
   */
  .post(
    '/sessions/:sessionId/start',
    async ({ request, params, body, set }) => {
      const { user, error: authError } = await authenticateRequest(request);
      if (authError || !user) {
        set.status = 401;
        return { error: authError || 'Unauthorized' };
      }

      const { participants, surpriseRound, sceneSpec } = body;

      // --- Bad payload: 422 with the stage that rejected it, before any work happens. ---
      if (!UUID_PATTERN.test(params.sessionId)) {
        set.status = 422;
        return {
          error: 'Invalid session id',
          stage: 'ownership',
          detail: 'sessionId must be a uuid',
        };
      }
      const rejection = participantsRejection(participants);
      if (rejection) {
        set.status = 422;
        return { error: 'Invalid combat start payload', stage: 'participants', detail: rejection };
      }

      let scene: SceneSpec | null = null;
      if (sceneSpec !== undefined && sceneSpec !== null) {
        const sanitized = sanitizeSceneSpec(sceneSpec, params.sessionId);
        if (!sanitized.ok) {
          set.status = 422;
          return {
            error: 'Invalid combat start payload',
            stage: 'map_generation',
            detail: sanitized.detail,
          };
        }
        scene = sanitized.sceneSpec;
        if (sanitized.overrides.length) {
          // Model-authored scene fields that the server refused to trust. `sessionId` is the
          // dangerous one: it is a real foreign key on the tactical map.
          logger.info({
            msg: 'Overrode model-supplied scene_spec fields on combat start',
            sessionId: params.sessionId,
            overrides: sanitized.overrides,
          });
        }
      }

      try {
        const verification = await runStage('ownership', () =>
          verifySessionOwnership(params.sessionId, user.userId),
        );
        if (!verification.success) {
          set.status = verification.error!.status;
          return {
            error: verification.error!.message,
            stage: 'ownership' satisfies CombatStartStage,
            detail: 'session is missing or not owned by the caller',
          };
        }

        // A start while combat is already running is a no-op that reports the encounter in
        // progress. Run 8 restarted combat four times in thirty turns because this endpoint
        // took every "start" literally: each one inserted a second active encounter, rerolled
        // initiative, and rebuilt the board mid-fight. An encounter now ends only by an end
        // transition or by every hostile going down — never by someone asking to begin again.
        const active = await runStage('ownership', () =>
          CombatEncounterService.getActiveEncounter(params.sessionId, user.userId),
        );
        if (active) {
          logger.info({
            msg: 'Ignored combat start for a session already in combat',
            sessionId: params.sessionId,
            encounterId: active.id,
            requestedParticipants: Array.isArray(participants) ? participants.length : 0,
          });
          const current = await runStage('participants', () =>
            CombatEncounterService.getCombatState(active.id, user.userId),
          );
          set.status = 200;
          return {
            ...current,
            initiativeOrder: buildInitiativeOrder(current),
            alreadyActive: true,
          };
        }

        const combatState = await runStage('participants', () =>
          CombatEncounterService.startCombat(
            params.sessionId,
            participants as CreateParticipantInput[],
            surpriseRound || false,
            user.userId,
          ),
        );

        if (scene) {
          await runStage('map_generation', () =>
            createTacticalCombatMap(
              params.sessionId,
              combatState.participants,
              scene,
              combatState.participantSizes,
            ),
          );
        }

        await runStage('persistence', async () => {
          trackCombatEvent('combat_started', {
            encounterId: combatState.encounter.id,
            sessionId: params.sessionId,
          });
          trackCombatEvent('initiative_completed', {
            encounterId: combatState.encounter.id,
            participants: combatState.participants.length,
          });
          await publishCombatState(combatState.encounter.id, user.userId, 'combat_started');
        });

        set.status = 201;
        // The client needs the whole order, monsters included, the moment combat starts.
        return { ...combatState, initiativeOrder: buildInitiativeOrder(combatState) };
      } catch (e) {
        // Log BEFORE mapping: mapCombatError discards everything but a status, so it must
        // never be the only witness to the failure. `error` is serialized in full by the
        // logger (message + stack + cause), which is how the real exception gets named.
        const stage = e instanceof CombatStartStageError ? e.stage : 'participants';
        logger.error({
          msg: 'Start combat error',
          sessionId: params.sessionId,
          userId: user.userId,
          stage,
          participantCount: Array.isArray(participants) ? participants.length : 0,
          hasSceneSpec: Boolean(scene),
          error: e instanceof CombatStartStageError ? (e.cause ?? e) : e,
        });

        if (e instanceof CombatStartStageError) {
          const cause = e.cause;
          if (cause instanceof AppError && cause.statusCode < 500) {
            set.status = cause.statusCode;
            return {
              error: cause.statusCode === 404 ? 'Session not found' : cause.message,
              stage,
              detail: cause.message,
            };
          }
          set.status = e.status >= 500 ? 500 : e.status;
          return { error: 'Failed to start combat encounter', stage, detail: e.detail };
        }

        const mapped = mapCombatError(
          set,
          e,
          'Failed to start combat encounter',
          'Session not found',
        );
        return { ...mapped, stage, detail: e instanceof Error ? e.message : String(e) };
      }
    },
    { params: sessionIdParams, body: startCombatSchema },
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

        const result = await CombatInitiativeService.rollInitiative(
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
        return mapCombatError(set, e, 'Failed to roll initiative', 'Combat participant not found');
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

        const result = await CombatInitiativeService.advanceTurn(params.encounterId, user.userId);
        if (verification.session)
          await resetTacticalMovementForTurn(verification.session.id, result.currentParticipant.id);
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
   * PATCH /v1/combat/:encounterId/reorder
   * Manually adjust initiative order
   */
  .patch(
    '/:encounterId/reorder',
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

        const { participantId, newInitiative } = body;

        if (!participantId || newInitiative === undefined) {
          set.status = 400;
          return { error: 'participantId and newInitiative are required' };
        }

        await CombatInitiativeService.reorderInitiative(
          params.encounterId,
          participantId,
          newInitiative,
          user.userId,
        );
        const combatState = await CombatEncounterService.getCombatState(
          params.encounterId,
          user.userId,
        );

        return combatState;
      } catch (e) {
        logger.error({ msg: 'Reorder initiative error', error: e });
        return mapCombatError(
          set,
          e,
          'Failed to reorder initiative',
          'Combat participant not found',
        );
      }
    },
    { params: encounterIdParams, body: reorderInitiativeSchema },
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
        );
      } catch (e) {
        logger.error({ msg: 'Abandon combat error', error: e });
        return mapCombatError(set, e, 'Failed to abandon combat encounter', 'Encounter not found');
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

        const combatState = await CombatEncounterService.getCombatState(
          params.encounterId,
          user.userId,
        );
        return { ...combatState, initiativeOrder: buildInitiativeOrder(combatState) };
      } catch (e) {
        logger.error({ msg: 'Get combat status error', error: e });
        return mapCombatError(set, e, 'Failed to get combat status', 'Encounter not found');
      }
    },
    { params: encounterIdParams },
  );
