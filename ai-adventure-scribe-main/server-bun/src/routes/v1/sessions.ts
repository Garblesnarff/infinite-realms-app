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
import { authenticateRequest } from '../../lib/auth.js';
import { planRateLimit } from '../../middleware/rate-limit.js';
import { SessionService } from '../../services/session-service.js';
import { logger } from '../../lib/logger.js';
import { NotFoundError } from '../../lib/errors.js';

/**
 * Helper to map camelCase Session to snake_case for API compatibility
 */
const mapSessionToApi = (session: any) => ({
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
  .post('/', async ({ body, set, user }) => {
    const { campaign_id, character_id, session_number } = body as {
      campaign_id?: string;
      character_id?: string;
      session_number?: number;
    };

    try {
      const session = await SessionService.createSession({
        campaignId: campaign_id,
        characterId: character_id,
        sessionNumber: session_number,
      }, (user as any).userId);

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
  })

  /**
   * GET /v1/sessions/:id
   * Get a session by ID (with ownership verification)
   */
  .get('/:id', async ({ params, set, user }) => {
    const { id } = params;

    try {
      const session = await SessionService.getSessionById(id, (user as any).userId);
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
      const session = await SessionService.completeSession(id, (user as any).userId, summary);
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
