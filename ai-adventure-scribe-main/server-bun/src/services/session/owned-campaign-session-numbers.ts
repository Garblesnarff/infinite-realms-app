import { and, eq, isNull, or } from 'drizzle-orm';

import { campaigns, characters, gameSessions } from '../../../../db/schema/index';
import { getCampaignSessionNumbers } from '../../../../shared/campaign-session-numbers.js';

import type { db } from '../../../../db/client';

/**
 * The campaign-local session number, one rule for the list card and the chronicle eyebrow (#1592).
 *
 * It ranks only the user's own sessions in the campaign, by created_at. A session belongs to the
 * owner of its character; a session with no character belongs to the campaign's owner. RLS is off,
 * so this filter is the owner check.
 *
 * The database handle is passed in (ctx.db in the chronicles router, db in the session service).
 * Kept out of session-service.ts on purpose: importing that module from the chronicles router pulls
 * its whole dependency graph into the CLI typecheck program (AGENTS.md section 11).
 */
export async function getOwnedCampaignSessionNumbers(
  database: typeof db,
  campaignId: string,
  userId: string,
): Promise<Map<string, number>> {
  const rows = await database
    .select({
      id: gameSessions.id,
      createdAt: gameSessions.createdAt,
    })
    .from(gameSessions)
    .leftJoin(characters, eq(characters.id, gameSessions.characterId))
    .leftJoin(campaigns, eq(campaigns.id, gameSessions.campaignId))
    .where(
      and(
        eq(gameSessions.campaignId, campaignId),
        or(
          eq(characters.userId, userId),
          eq(characters.ownerId, userId),
          and(isNull(gameSessions.characterId), eq(campaigns.userId, userId)),
        ),
      ),
    );

  return getCampaignSessionNumbers(
    rows.map((row) => ({
      id: row.id,
      created_at:
        row.createdAt instanceof Date
          ? row.createdAt.toISOString()
          : row.createdAt
            ? String(row.createdAt)
            : null,
    })),
  );
}
