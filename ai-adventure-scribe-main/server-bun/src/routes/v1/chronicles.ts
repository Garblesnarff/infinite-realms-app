/**
 * Chronicle sharing routes for Elysia
 *
 * - POST /v1/chronicles/:id/share (auth) - enable sharing
 * - DELETE /v1/chronicles/:id/share (auth) - revoke sharing
 * - GET /v1/public/chronicles/:token (public) - read a shared chronicle
 */

import { and, eq } from 'drizzle-orm';
import { Elysia, t } from 'elysia';

import { db } from '../../../../db/client';
import { campaigns, gameSessions, sessionChronicles } from '../../../../db/schema/index';
import { planHasPaidFeatures } from '../../../../shared/plan-features.js';
import { resolveUserPlanStrict } from '../../lib/user-plan.js';
import { requireAuth } from '../../middleware/auth.js';
import { chronicleGenerator } from '../../services/chronicle-generator.js';

const chronicleIdParams = t.Object({
  id: t.String({ format: 'uuid' }),
});

const publicTokenParams = t.Object({
  token: t.String({ minLength: 1, maxLength: 255 }),
});

const shareRoutes = new Elysia({ prefix: '/v1/chronicles' })
  .use(requireAuth)
  .post(
    '/:id/share',
    async ({ params, set, user }) => {
      const userId = (user as { userId: string }).userId;
      const rows = await db
        .select()
        .from(sessionChronicles)
        .where(and(eq(sessionChronicles.id, params.id), eq(sessionChronicles.userId, userId)))
        .limit(1);
      const row = rows[0];
      if (!row) {
        set.status = 404;
        return { error: 'Chronicle not found' };
      }
      if (row.status !== 'ready') {
        set.status = 409;
        return { error: 'Chronicle is not ready' };
      }
      let plan: string;
      try {
        plan = await resolveUserPlanStrict(userId);
      } catch {
        set.status = 503;
        return { error: 'Plan lookup unavailable' };
      }
      if (!planHasPaidFeatures(plan)) {
        set.status = 403;
        return { error: 'Sharing needs the Pro plan' };
      }
      const shareToken = row.shareToken ?? chronicleGenerator.generateShareToken();
      await db
        .update(sessionChronicles)
        .set({
          shareEnabled: true,
          shareToken,
          updatedAt: new Date(),
        })
        .where(and(eq(sessionChronicles.id, params.id), eq(sessionChronicles.userId, userId)));
      set.status = 200;
      return { shareToken, shareEnabled: true };
    },
    { params: chronicleIdParams },
  )
  .delete(
    '/:id/share',
    async ({ params, set, user }) => {
      const userId = (user as { userId: string }).userId;
      const rows = await db
        .select()
        .from(sessionChronicles)
        .where(and(eq(sessionChronicles.id, params.id), eq(sessionChronicles.userId, userId)))
        .limit(1);
      if (!rows[0]) {
        set.status = 404;
        return { error: 'Chronicle not found' };
      }
      await db
        .update(sessionChronicles)
        .set({
          shareEnabled: false,
          shareToken: null,
          updatedAt: new Date(),
        })
        .where(and(eq(sessionChronicles.id, params.id), eq(sessionChronicles.userId, userId)));
      set.status = 200;
      return { shareEnabled: false };
    },
    { params: chronicleIdParams },
  );

const publicRoutes = new Elysia({ prefix: '/v1/public/chronicles' }).get(
  '/:token',
  async ({ params, set }) => {
    const rows = await db
      .select({
        chapterTitle: sessionChronicles.chapterTitle,
        chronicleText: sessionChronicles.chronicleText,
        illustrationUrl: sessionChronicles.illustrationUrl,
        sessionNumber: gameSessions.sessionNumber,
        campaignName: campaigns.name,
      })
      .from(sessionChronicles)
      .leftJoin(gameSessions, eq(sessionChronicles.sessionId, gameSessions.id))
      .leftJoin(campaigns, eq(gameSessions.campaignId, campaigns.id))
      .where(
        and(
          eq(sessionChronicles.shareToken, params.token),
          eq(sessionChronicles.shareEnabled, true),
          eq(sessionChronicles.status, 'ready'),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row || !row.chapterTitle) {
      set.status = 404;
      return { error: 'Chronicle not found' };
    }
    set.headers['Cache-Control'] = 'no-store';
    return {
      title: row.chapterTitle,
      illustrationUrl: row.illustrationUrl ?? null,
      story: row.chronicleText ?? '',
      campaignName: row.campaignName ?? null,
      sessionNumber: row.sessionNumber ?? null,
    };
  },
  { params: publicTokenParams },
);

export const chroniclesV1Routes = new Elysia().use(publicRoutes).use(shareRoutes);
