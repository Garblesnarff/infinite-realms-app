/* eslint-disable import/order, max-lines */
/**
 * Session Routes for Elysia
 *
 * Provides game session endpoints:
 * - POST /v1/sessions - Create game session
 * - GET /v1/sessions/:id - Get session
 * - GET /v1/sessions/:id/context - Get joined gameplay context
 * - POST /v1/sessions/:id/complete - Complete session
 *
 * Refactored to use SessionService with proper ownership verification
 * and existence masking.
 */

import { Elysia, t } from 'elysia';
import { eq } from 'drizzle-orm';

import { planHasPaidFeatures } from '../../../../shared/plan-features.js';
import { logger } from '../../lib/logger.js';
import { NotFoundError } from '../../lib/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { planRateLimit } from '../../middleware/rate-limit.js';
import { SessionService } from '../../services/session-service.js';
import { db } from '../../../../db/client';
import { sessionChronicles } from '../../../../db/schema/index';
import { chronicleGenerator, persistChronicleFailure } from '../../services/chronicle-generator.js';
import { getSessionContextRouteResult } from './session-context-handler.js';
import { getSessionListRouteResult } from './session-list-handler.js';

import type { GameSession } from '../../../../db/schema/index';

/**
 * Helper to map camelCase Session to snake_case for API compatibility
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mapSessionToApi = (session: GameSession): any => ({
  id: session.id,
  campaign_id: session.campaignId,
  character_id: session.characterId,
  session_number: session.sessionNumber,
  start_time: session.startTime,
  end_time: session.endTime,
  status: session.status,
  current_scene_description: session.currentSceneDescription,
  summary: session.summary,
  session_notes: session.sessionNotes,
  turn_count: session.turnCount,
  session_state: session.sessionState,
  starter_campaign_id: session.starterCampaignId,
  campaign_version: session.campaignVersion,
  ruleset: session.ruleset,
  created_at: session.createdAt,
  updated_at: session.updatedAt,
});

/**
 * Validation schema for creating a session
 */
const createSessionSchema = t.Object({
  campaign_id: t.Optional(t.Nullable(t.String({ minLength: 1, maxLength: 255 }))),
  character_id: t.Optional(t.Nullable(t.String({ minLength: 1, maxLength: 255 }))),
  session_number: t.Optional(t.Number({ minimum: 1, maximum: 100_000 })),
  status: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
  summary: t.Optional(t.Nullable(t.String({ maxLength: 100_000 }))),
  current_scene_description: t.Optional(t.Nullable(t.String({ maxLength: 100_000 }))),
  session_notes: t.Optional(t.Nullable(t.String({ maxLength: 100_000 }))),
  turn_count: t.Optional(t.Number({ minimum: 0, maximum: 10_000_000 })),
  starter_campaign_id: t.Optional(t.Nullable(t.String({ minLength: 1, maxLength: 255 }))),
  campaign_version: t.Optional(t.Nullable(t.Number({ minimum: 0, maximum: 1_000_000 }))),
});

const updateSessionSchema = t.Partial(
  t.Object({
    status: t.String({ minLength: 1, maxLength: 100 }),
    summary: t.Nullable(t.String({ maxLength: 100_000 })),
    current_scene_description: t.Nullable(t.String({ maxLength: 100_000 })),
    session_notes: t.Nullable(t.String({ maxLength: 100_000 })),
    turn_count: t.Number({ minimum: 0, maximum: 10_000_000 }),
    session_state: t.Any(),
    starter_campaign_id: t.Nullable(t.String({ minLength: 1, maxLength: 255 })),
    campaign_version: t.Nullable(t.Number({ minimum: 0, maximum: 1_000_000 })),
    end_time: t.Nullable(t.String({ minLength: 1, maxLength: 100 })),
  }),
);

const sessionIdParams = t.Object({
  id: t.String({ minLength: 1, maxLength: 255 }),
});

const listSessionsQuery = t.Object({
  campaign_id: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
  character_id: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
  status: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
  starter_only: t.Optional(t.String({ minLength: 1, maxLength: 10 })),
  limit: t.Optional(t.String({ minLength: 1, maxLength: 6 })),
  offset: t.Optional(t.String({ minLength: 1, maxLength: 10 })),
});

const completeSessionSchema = t.Object({
  summary: t.Optional(t.String({ maxLength: 100_000 })),
});

export const sessionsRoutes = new Elysia({ prefix: '/v1/sessions' })
  .use(requireAuth)
  .resolve({ as: 'scoped' }, async ({ user, params }) => {
    let session = null;
    if (user && params?.id) {
      try {
        session = await SessionService.getSessionById(
          params.id,
          (user as { userId: string }).userId,
        );
      } catch (_error) {
        // Return null so onBeforeHandle can respond with 404
      }
    }
    return { session };
  })
  .onBeforeHandle(async ({ params, session, set }) => {
    if (params?.id && !session) {
      set.status = 404;
      return { error: 'Not found' };
    }
  })

  /**
   * POST /v1/sessions
   * Create a new game session
   */
  .use(planRateLimit('default'))
  .post(
    '/',
    async ({ body, set, user }) => {
      const { campaign_id, character_id, session_number, status } = body;

      try {
        const session = await SessionService.createSession(
          {
            campaignId: campaign_id,
            characterId: character_id,
            sessionNumber: session_number,
            status: status || undefined,
            summary: body.summary,
            currentSceneDescription: body.current_scene_description,
            sessionNotes: body.session_notes,
            turnCount: body.turn_count,
            starterCampaignId: body.starter_campaign_id,
            campaignVersion: body.campaign_version,
          },
          (user as { userId: string }).userId,
        );

        set.status = 201;
        return mapSessionToApi(session);
      } catch (error) {
        if (error instanceof NotFoundError) {
          set.status = 404;
          return { error: error.message };
        }
        logger.error({ msg: 'SESSION_CREATE error', error });
        set.status = 500;
        return { error: 'Failed to create session' };
      }
    },
    {
      body: createSessionSchema,
    },
  )

  .get(
    '/',
    async ({ query, user }) =>
      getSessionListRouteResult(
        query,
        (user as { userId: string }).userId,
        SessionService.listSessions,
      ),
    { query: listSessionsQuery },
  )

  /**
   * GET /v1/sessions/:id
   * Get a session by ID (with ownership verification)
   */
  .get(
    '/:id',
    async ({ session }) => {
      return mapSessionToApi(session as GameSession);
    },
    { params: sessionIdParams },
  )

  /**
   * GET /v1/sessions/:id/context
   * Get session, campaign, character, and stats with ownership verification.
   */
  .get(
    '/:id/context',
    async ({ params, set, user }) => {
      try {
        const result = await getSessionContextRouteResult(
          params.id,
          (user as { userId: string }).userId,
          SessionService.getSessionContext,
        );
        set.status = result.status;
        return result.body;
      } catch (error) {
        logger.error({ msg: 'SESSION_CONTEXT_GET error', sessionId: params.id, error });
        set.status = 500;
        return { error: 'Failed to fetch session context' };
      }
    },
    { params: sessionIdParams },
  )

  .patch(
    '/:id',
    async ({ params, body, set, user }) => {
      try {
        const updated = await SessionService.updateSession(
          params.id,
          (user as { userId: string }).userId,
          {
            status: body.status,
            summary: body.summary,
            currentSceneDescription: body.current_scene_description,
            sessionNotes: body.session_notes,
            turnCount: body.turn_count,
            sessionState: body.session_state,
            starterCampaignId: body.starter_campaign_id,
            campaignVersion: body.campaign_version,
            endTime:
              typeof body.end_time === 'string'
                ? new Date(body.end_time)
                : body.end_time === null
                  ? null
                  : undefined,
          },
        );
        return mapSessionToApi(updated);
      } catch (error) {
        if (error instanceof NotFoundError) {
          set.status = 404;
          return { error: 'Not found' };
        }
        throw error;
      }
    },
    { params: sessionIdParams, body: updateSessionSchema },
  )

  /**
   * POST /v1/sessions/:id/complete
   * Mark a session as complete
   */
  .post(
    '/:id/complete',
    async ({ params, body, set, user }) => {
      const { id } = params;
      const { summary } = body;

      try {
        const session = await SessionService.completeSession(
          id,
          (user as { userId: string }).userId,
          summary,
        );

        // Auto-generate chronicle for Pro/Enterprise users (fire-and-forget, never blocks response)
        const userPlan = (user as { userId: string; plan?: string }).plan;
        if (planHasPaidFeatures(userPlan)) {
          const sessionUserId = (user as { userId: string }).userId;
          const sessionIdForChronicle = id;
          (async () => {
            let chronicleId: string | undefined;
            try {
              chronicleId = await db.transaction(async (tx) => {
                const [row] = await tx
                  .insert(sessionChronicles)
                  .values({
                    sessionId: sessionIdForChronicle,
                    userId: sessionUserId,
                    status: 'generating',
                  })
                  .returning({ id: sessionChronicles.id });
                if (!row) throw new Error('Failed to create chronicle row');
                return row.id;
              });

              const content = await chronicleGenerator.generateProChronicle(
                sessionIdForChronicle,
                sessionUserId,
                userPlan || 'free',
              );
              const illustrationUrl = await chronicleGenerator.generateIllustration(
                content.illustrationPrompt,
              );
              if (!chronicleId) throw new Error('Chronicle row was not created');
              const completedChronicleId = chronicleId;

              await db.transaction(async (tx) => {
                await tx
                  .update(sessionChronicles)
                  .set({
                    status: 'ready',
                    chronicleText: content.chronicleText,
                    chapterTitle: content.chapterTitle,
                    previouslyOn: content.previouslyOn,
                    illustrationUrl,
                    shareToken: chronicleGenerator.generateShareToken(),
                    generatedAt: new Date(),
                    updatedAt: new Date(),
                  })
                  .where(eq(sessionChronicles.id, completedChronicleId));
              });

              logger.info({
                msg: '[Sessions] Chronicle generated',
                sessionId: sessionIdForChronicle,
              });
            } catch (err) {
              if (chronicleId) {
                try {
                  await persistChronicleFailure(db, chronicleId, err);
                } catch (statusError) {
                  logger.error({
                    msg: '[Sessions] Chronicle failure status update failed',
                    sessionId: sessionIdForChronicle,
                    chronicleId,
                    error: statusError,
                  });
                }
              }
              logger.error({
                msg: '[Sessions] Auto chronicle failed',
                sessionId: sessionIdForChronicle,
                error: err,
              });
            }
          })();
        }

        return mapSessionToApi(session);
      } catch (error) {
        if (error instanceof NotFoundError) {
          set.status = 404;
          return { error: 'Not found' };
        }
        logger.error({ msg: 'SESSION_COMPLETE error', error });
        set.status = 500;
        return { error: 'Failed to complete session' };
      }
    },
    { params: sessionIdParams, body: completeSessionSchema },
  );
