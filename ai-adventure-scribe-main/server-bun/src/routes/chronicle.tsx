/**
 * Chronicle Routes
 *
 * Public SSR routes for shared session chronicles.
 * No authentication required — access is controlled by the share token.
 */

import { and, eq, isNotNull } from 'drizzle-orm';
import { Elysia } from 'elysia';

import { db } from '../../../db/client';
import { sessionChronicles, gameSessions, campaigns } from '../../../db/schema/game.js';
import { getSiteConfig } from '../config/site.js';
import { logger } from '../lib/logger.js';
import { streamReactResponse } from '../utils/react-stream.js';
import { ChronicleSharePage } from '../views/chronicle/share.js';

/**
 * Cache headers for the public chronicle share page.
 * Revocation must take effect at once, so nothing is cached.
 */
const CHRONICLE_CACHE_HEADERS = {
  'Cache-Control': 'no-store',
  'CDN-Cache-Control': 'no-store',
  'Surrogate-Control': 'no-store',
  Vary: 'Accept-Encoding, Accept-Language',
} as const;

/**
 * Chronicle SSR routes
 *
 * Mounted with prefix /chronicle.
 * All routes are public (no auth middleware).
 */
export const chronicleRoutes = new Elysia({ prefix: '/chronicle' })
  // Public share page — accessed via share token
  .get('/:token', async ({ params, set, request }) => {
    const { token } = params;

    try {
      // Fetch chronicle by share token, joining session + campaign for metadata.
      // Note: gameSessions.campaignId is nullable so leftJoin is used.
      // Drizzle requires nullable FK column first in eq() for correct type narrowing.
      const rows = await db
        .select({
          chapterTitle: sessionChronicles.chapterTitle,
          chronicleText: sessionChronicles.chronicleText,
          illustrationUrl: sessionChronicles.illustrationUrl,
          generatedAt: sessionChronicles.generatedAt,
          status: sessionChronicles.status,
          shareToken: sessionChronicles.shareToken,
          sessionNumber: gameSessions.sessionNumber,
          campaignName: campaigns.name,
        })
        .from(sessionChronicles)
        .leftJoin(gameSessions, eq(sessionChronicles.sessionId, gameSessions.id))
        .leftJoin(campaigns, eq(gameSessions.campaignId, campaigns.id))
        .where(
          and(
            eq(sessionChronicles.shareToken, token),
            eq(sessionChronicles.shareEnabled, true),
            eq(sessionChronicles.status, 'ready'),
            isNotNull(sessionChronicles.chapterTitle),
          ),
        )
        .limit(1);

      const row = rows[0];

      // 404: not found, not ready, or missing chapter title
      if (!row || row.status !== 'ready' || !row.chapterTitle) {
        set.status = 404;
        return new Response('Chronicle not found', {
          status: 404,
          headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' },
        });
      }

      const appOrigin = process.env.CORS_ORIGIN?.split(',')[0]?.trim() || getSiteConfig().url;
      let appHost: string | null = null;
      try {
        appHost = new URL(appOrigin).host;
      } catch {
        appHost = null;
      }
      const requestHost = request.headers.get('host');
      if (appHost && appHost !== requestHost) {
        set.status = 302;
        return new Response(null, {
          status: 302,
          headers: {
            Location: `${appOrigin}/chronicle/${encodeURIComponent(token)}`,
            'Cache-Control': 'no-store',
          },
        });
      }

      return await streamReactResponse(
        <ChronicleSharePage
          chronicle={{
            chapterTitle: row.chapterTitle,
            chronicleText: row.chronicleText ?? '',
            illustrationUrl: row.illustrationUrl ?? null,
            generatedAt: row.generatedAt ?? null,
            sessionNumber: row.sessionNumber ?? null,
            campaignName: row.campaignName ?? 'Unknown Campaign',
            shareToken: row.shareToken ?? token,
          }}
        />,
        {
          headers: CHRONICLE_CACHE_HEADERS,
        },
      );
    } catch (error) {
      // ⚡ Bolt: Use non-blocking structured logger for better performance and observability
      logger.error({ error }, 'Failed to render chronicle share page');
      set.status = 500;
      return new Response('Failed to render chronicle', {
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
      });
    }
  });
