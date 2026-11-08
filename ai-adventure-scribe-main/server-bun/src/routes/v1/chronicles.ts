/**
 * Chronicle sharing routes for Elysia
 *
 * - POST /v1/chronicles/:id/share (auth) - enable sharing
 * - DELETE /v1/chronicles/:id/share (auth) - revoke sharing
 * - GET /v1/public/chronicles/:token (public) - read a shared chronicle
 */

import { and, eq, isNotNull } from 'drizzle-orm';
import { Elysia, t } from 'elysia';

import { db } from '../../../../db/client';
import {
  campaigns,
  gameSessions,
  sessionChronicles,
  starterCampaigns,
} from '../../../../db/schema/index';
import { planHasPaidFeatures } from '../../../../shared/plan-features.js';
import { resolveUserPlanStrict } from '../../lib/user-plan.js';
import { requireAuth } from '../../middleware/auth.js';
import { chronicleGenerator } from '../../services/chronicle-generator.js';

const chronicleIdParams = t.Object({
  id: t.String({ format: 'uuid' }),
});

const publicTokenParams = t.Object({
  token: t.String({ minLength: 1 }),
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
      const result = await db.transaction(async (tx) => {
        const lockedRows = await tx
          .select()
          .from(sessionChronicles)
          .where(and(eq(sessionChronicles.id, params.id), eq(sessionChronicles.userId, userId)))
          .for('update');
        const lockedRow = lockedRows[0];
        if (!lockedRow) return { kind: 'not_found' } as const;
        if (lockedRow.status !== 'ready' || !lockedRow.chapterTitle) {
          return { kind: 'not_publishable' } as const;
        }
        const token = lockedRow.shareToken ?? chronicleGenerator.generateShareToken();
        const [updated] = await tx
          .update(sessionChronicles)
          .set({
            shareEnabled: true,
            shareToken: token,
            updatedAt: new Date(),
          })
          .where(and(eq(sessionChronicles.id, params.id), eq(sessionChronicles.userId, userId)))
          .returning({ shareToken: sessionChronicles.shareToken });
        return { kind: 'ok', shareToken: updated.shareToken } as const;
      });
      if (result.kind === 'not_found') {
        set.status = 404;
        return { error: 'Chronicle not found' };
      }
      if (result.kind === 'not_publishable') {
        set.status = 409;
        return { error: 'Write the full chronicle before sharing' };
      }
      set.status = 200;
      return { shareToken: result.shareToken, shareEnabled: true };
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
      const result = await db.transaction(async (tx) => {
        const lockedRows = await tx
          .select()
          .from(sessionChronicles)
          .where(and(eq(sessionChronicles.id, params.id), eq(sessionChronicles.userId, userId)))
          .for('update');
        if (!lockedRows[0]) return { kind: 'not_found' } as const;
        await tx
          .update(sessionChronicles)
          .set({
            shareEnabled: false,
            shareToken: null,
            updatedAt: new Date(),
          })
          .where(and(eq(sessionChronicles.id, params.id), eq(sessionChronicles.userId, userId)));
        return { kind: 'ok' } as const;
      });
      if (result.kind === 'not_found') {
        set.status = 404;
        return { error: 'Chronicle not found' };
      }
      set.status = 200;
      return { shareEnabled: false };
    },
    { params: chronicleIdParams },
  );

const publicRoutes = new Elysia({ prefix: '/v1/public/chronicles' }).get(
  '/:token',
  async ({ params, set }) => {
    if (params.token.length > 255) {
      set.status = 404;
      return { error: 'Chronicle not found' };
    }
    const rows = await db
      .select({
        chapterTitle: sessionChronicles.chapterTitle,
        chronicleText: sessionChronicles.chronicleText,
        illustrationUrl: sessionChronicles.illustrationUrl,
        sessionNumber: gameSessions.sessionNumber,
        campaignName: campaigns.name,
        starterSlug: starterCampaigns.slug,
        starterTitle: starterCampaigns.title,
        starterTagline: starterCampaigns.tagline,
        starterCoverImageUrl: starterCampaigns.coverImageUrl,
      })
      .from(sessionChronicles)
      .leftJoin(gameSessions, eq(sessionChronicles.sessionId, gameSessions.id))
      .leftJoin(campaigns, eq(gameSessions.campaignId, campaigns.id))
      .leftJoin(
        starterCampaigns,
        and(
          eq(gameSessions.starterCampaignId, starterCampaigns.id),
          eq(starterCampaigns.isPublished, true),
        ),
      )
      .where(
        and(
          eq(sessionChronicles.shareToken, params.token),
          eq(sessionChronicles.shareEnabled, true),
          eq(sessionChronicles.status, 'ready'),
          isNotNull(sessionChronicles.chapterTitle),
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
      publicCampaign: row.starterSlug
        ? {
            slug: row.starterSlug,
            title: row.starterTitle,
            tagline: row.starterTagline,
            coverImageUrl: row.starterCoverImageUrl,
          }
        : null,
    };
  },
  { params: publicTokenParams },
);

export const chroniclesV1Routes = new Elysia().use(publicRoutes).use(shareRoutes);
