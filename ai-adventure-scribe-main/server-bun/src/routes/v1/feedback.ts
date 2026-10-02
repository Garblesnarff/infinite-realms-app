/**
 * Feedback route: POST /v1/feedback
 *
 * Backs the "Send feedback" modal (game header and /app/account). Open to signed-out callers,
 * so the user id is attached only when a valid bearer token is present. Rate limited per IP and
 * per user. Each submission is logged as ANALYTICS_FEEDBACK and stored in the `feedback` table.
 * No email is sent.
 */
import { Elysia, t } from 'elysia';

import { db } from '../../../../db/client';
import { feedback } from '../../../../db/schema/index';
import { authenticateRequest } from '../../lib/auth.js';
import { logger } from '../../lib/logger.js';
import { planRateLimit } from '../../middleware/rate-limit.js';

export const FEEDBACK_MESSAGE_MAX = 4_000;

const FEEDBACK_RATE = {
  key: 'feedback',
  perIp: { windowMs: 3_600_000, maxByPlan: { free: 20, pro: 20, enterprise: 20 } },
  perUser: { windowMs: 3_600_000, maxByPlan: { free: 10, pro: 10, enterprise: 10 } },
};

export const feedbackRoutes = new Elysia({ prefix: '/v1/feedback' })
  // Attach `user` when a valid token is sent; planRateLimit reads it for the per-user bucket.
  .resolve({ as: 'scoped' }, async ({ request }) => {
    if (!request.headers.get('authorization')) return { user: null };
    const { user } = await authenticateRequest(request);
    return { user };
  })
  .use(planRateLimit(FEEDBACK_RATE))
  .post(
    '/',
    async ({ body, user, set }) => {
      const message = body.message.trim();
      if (!message) {
        set.status = 400;
        return { error: 'Message is required' };
      }

      const row = {
        message,
        page: body.page,
        build: body.build ?? null,
        campaignSlug: body.campaignSlug ?? null,
        sessionId: body.sessionId ?? null,
        userId: user?.userId ?? null,
      };

      logger.info({
        msg: 'ANALYTICS_FEEDBACK',
        page: row.page,
        build: row.build,
        campaignSlug: row.campaignSlug,
        sessionId: row.sessionId,
        userId: row.userId,
        message: row.message,
      });

      try {
        await db.insert(feedback).values(row);
      } catch (error) {
        logger.error({ msg: 'FEEDBACK_INSERT_FAILED', error });
        set.status = 503;
        return { error: 'Could not save feedback' };
      }

      set.status = 201;
      return { success: true };
    },
    {
      body: t.Object({
        message: t.String({ minLength: 1, maxLength: FEEDBACK_MESSAGE_MAX }),
        page: t.String({ minLength: 1, maxLength: 300 }),
        build: t.Optional(t.String({ maxLength: 100 })),
        campaignSlug: t.Optional(t.String({ maxLength: 200 })),
        sessionId: t.Optional(t.String({ maxLength: 200 })),
      }),
    },
  );
