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
import { recordEncounterOutcome, getDifficultyAdjustment } from '../../lib/encounter-telemetry.js';
import { requireAuth } from '../../middleware/auth.js';
import { planRateLimit } from '../../middleware/rate-limit.js';

const encounterTelemetrySchema = t.Object({
  // Optional fields preserve the route's existing "Missing required fields" response.
  sessionId: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
  difficulty: t.Optional(t.String({ minLength: 1, maxLength: 50 })),
  resourcesUsedEst: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
});

const encounterAdjustmentQuery = t.Object({
  sessionId: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
  difficulty: t.Optional(t.String({ minLength: 1, maxLength: 50 })),
});

export const encountersRoutes = new Elysia({ prefix: '/v1/encounters' })
  .use(requireAuth)
  .use(planRateLimit('default'))

  /**
   * POST /v1/encounters/telemetry
   * Record encounter outcome for difficulty tracking
   */
  .post('/telemetry', async ({ body, set, user }) => {
    const { sessionId, difficulty, resourcesUsedEst } = body;

    if (!sessionId || !difficulty || typeof resourcesUsedEst !== 'number') {
      set.status = 400;
      return { ok: false, error: 'Missing required fields' };
    }

    const verification = await verifySessionOwnership(sessionId, user.userId);
    if (!verification.success) {
      set.status = verification.error?.status || 404;
      return { ok: false, error: verification.error?.message || 'Session not found' };
    }

    recordEncounterOutcome(sessionId, difficulty, resourcesUsedEst);
    return { ok: true };
  }, { body: encounterTelemetrySchema })

  /**
   * GET /v1/encounters/adjustment
   * Get difficulty adjustment factor for a session
   */
  .get('/adjustment', async ({ query, set, user }) => {
    const { sessionId, difficulty } = query;

    if (!sessionId || !difficulty) {
      set.status = 400;
      return { ok: false, error: 'Missing query params' };
    }

    const verification = await verifySessionOwnership(sessionId, user.userId);
    if (!verification.success) {
      set.status = verification.error?.status || 404;
      return { ok: false, error: verification.error?.message || 'Session not found' };
    }

    const factor = getDifficultyAdjustment(sessionId, difficulty);
    return { ok: true, factor };
  }, { query: encounterAdjustmentQuery });
