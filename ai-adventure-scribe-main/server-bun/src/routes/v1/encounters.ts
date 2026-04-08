/**
 * Encounters Routes for Elysia
 *
 * Provides encounter telemetry endpoints:
 * - POST /v1/encounters/telemetry - Record encounter outcome
 * - GET /v1/encounters/adjustment - Get difficulty adjustment factor
 *
 * Ported from /server/src/routes/v1/encounters.ts
 */

import { Elysia, t } from 'elysia';

import { verifySessionOwnership } from './combat/helpers.js';
import { authenticateRequest } from '../../lib/auth.js';
import { recordEncounterOutcome, getDifficultyAdjustment } from '../../lib/encounter-telemetry.js';
import { planRateLimit } from '../../middleware/rate-limit.js';

export const encountersRoutes = new Elysia({ prefix: '/v1/encounters' })

  /**
   * POST /v1/encounters/telemetry
   * Record encounter outcome for difficulty tracking
   */
  .use(planRateLimit('default'))
  .post('/telemetry', async ({ request, body, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { sessionId, difficulty, resourcesUsedEst } = body as {
      sessionId?: string;
      difficulty?: string;
      resourcesUsedEst?: number;
    };

    if (!sessionId || !difficulty || typeof resourcesUsedEst !== 'number') {
      set.status = 400;
      return { ok: false, error: 'Missing required fields' };
    }

    const verification = await verifySessionOwnership(sessionId, user.userId);
    if (!verification.success) {
      set.status = verification.error!.status;
      return { ok: false, error: verification.error!.message };
    }

    recordEncounterOutcome(sessionId, difficulty, resourcesUsedEst);
    return { ok: true };
  })

  /**
   * GET /v1/encounters/adjustment
   * Get difficulty adjustment factor for a session
   */
  .get('/adjustment', async ({ request, query, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const sessionId = query.sessionId as string;
    const difficulty = query.difficulty as string;

    if (!sessionId || !difficulty) {
      set.status = 400;
      return { ok: false, error: 'Missing query params' };
    }

    const verification = await verifySessionOwnership(sessionId, user.userId);
    if (!verification.success) {
      set.status = verification.error!.status;
      return { ok: false, error: verification.error!.message };
    }

    const factor = getDifficultyAdjustment(sessionId, difficulty);
    return { ok: true, factor };
  });
