/**
 * Chronicle Routes
 *
 * Public SSR routes for shared session chronicles.
 * No authentication required — access is controlled by the share token.
 */

import { eq } from 'drizzle-orm';
import { Elysia } from 'elysia';

import { db } from '../../../db/client';
import { sessionChronicles, gameSessions, campaigns } from '../../../db/schema/game.js';
import { logger } from '../lib/logger.js';
import { streamReactResponse } from '../utils/react-stream.js';
import { ChronicleSharePage } from '../views/chronicle/share.js';

/**
 * Cache headers for the public chronicle share page.
 * Chronicles are immutable once generated — cache aggressively.
 */
const CHRONICLE_CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
  'CDN-Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
  'Surrogate-Control': 'public, max-age=3600, stale-while-revalidate=86400',
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
  .get('/:token', async ({ params, set }) => {
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
        .where(eq(sessionChronicles.shareToken, token))
        .limit(1);

      const row = rows[0];

      // 404: not found, not ready, or missing chapter title
      if (!row || row.status !== 'ready' || !row.chapterTitle) {
        set.status = 404;
        return new Response('Chronicle not found', {
          status: 404,
          headers: { 'Content-Type': 'text/plain' },
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
