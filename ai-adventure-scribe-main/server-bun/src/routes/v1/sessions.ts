/* eslint-disable import/order */
/**
 * Session Routes for Elysia
 *
 * Provides game session endpoints:
 * - POST /v1/sessions - Create game session
 * - GET /v1/sessions/:id - Get session
 * - POST /v1/sessions/:id/complete - Complete session
 *
 * Refactored to use SessionService with proper ownership verification
 * and existence masking.
 */

import { Elysia, t } from 'elysia';
import { eq } from 'drizzle-orm';

import { logger } from '../../lib/logger.js';
import { NotFoundError } from '../../lib/errors.js';
import { authenticateRequest } from '../../lib/auth.js';
import { planRateLimit } from '../../middleware/rate-limit.js';
import { SessionService } from '../../services/session-service.js';
import { db } from '../../../../db/client';
import { sessionChronicles } from '../../../../db/schema/index';
import { chronicleGenerator } from '../../services/chronicle-generator.js';
import { persistChronicleFailure } from '../../services/chronicle-status-service.js';

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
  campaign_id: t.Optional(t.Nullable(t.String())),
  character_id: t.Optional(t.Nullable(t.String())),
  session_number: t.Optional(t.Number({ minimum: 1 })),
  status: t.Optional(t.String()),
});

export const sessionsRoutes = new Elysia({ prefix: '/v1/sessions' })
  .derive(async ({ request }) => {
    const { user, error: authError } = await authenticateRequest(request);
    return { user, authError };
  })
  .onBeforeHandle(({ user, authError, set }) => {
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
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

  /**
   * GET /v1/sessions/:id
   * Get a session by ID (with ownership verification)
   */
  .get('/:id', async ({ params, set, user }) => {
    const { id } = params;

    try {
      const session = await SessionService.getSessionById(id, (user as { userId: string }).userId);
      return mapSessionToApi(session);
    } catch (error) {
      if (error instanceof NotFoundError) {
        set.status = 404;
        return { error: 'Not found' };
      }
      logger.error({ msg: 'SESSION_GET error', error });
      set.status = 500;
      return { error: 'Failed to fetch session' };
    }
  })

  /**
   * POST /v1/sessions/:id/complete
   * Mark a session as complete
   */
  .post('/:id/complete', async ({ params, body, set, user }) => {
    const { id } = params;
    const { summary } = body as { summary?: string };

    try {
      const session = await SessionService.completeSession(
        id,
        (user as { userId: string }).userId,
        summary,
      );

      // Auto-generate chronicle for Pro/Enterprise users (fire-and-forget, never blocks response)
      const userPlan = (user as { userId: string; plan?: string }).plan;
      if (userPlan === 'pro' || userPlan === 'enterprise') {
        const sessionUserId = (user as { userId: string }).userId;
        const sessionIdForChronicle = id;
        (async () => {
          let chronicleId: string | undefined;
          try {
            chronicleId = await db.transaction(async (tx) => {
              const [row] = await tx.insert(sessionChronicles).values({
                  sessionId: sessionIdForChronicle, userId: sessionUserId, status: 'generating',
                }).returning({ id: sessionChronicles.id });
              if (!row) throw new Error('Failed to create chronicle row');
              return row.id;
            });

            const content = await chronicleGenerator.generateProChronicle(
              sessionIdForChronicle,
              sessionUserId,
            );
            const illustrationUrl = await chronicleGenerator.generateIllustration(
              content.illustrationPrompt,
            );
            if (!chronicleId) throw new Error('Chronicle row was not created');
            const completedChronicleId = chronicleId;

            await db.transaction(async (tx) => {
              await tx.update(sessionChronicles).set({
                status: 'ready',
                chronicleText: content.chronicleText,
                chapterTitle: content.chapterTitle,
                previouslyOn: content.previouslyOn,
                illustrationUrl,
                shareToken: chronicleGenerator.generateShareToken(),
                generatedAt: new Date(),
                updatedAt: new Date(),
              }).where(eq(sessionChronicles.id, completedChronicleId));
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
                logger.error({ msg: '[Sessions] Chronicle failure status update failed', sessionId: sessionIdForChronicle, chronicleId, error: statusError });
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
  });
