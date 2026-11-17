import { and, eq, inArray, isNull, or } from 'drizzle-orm';

import { db } from '../../../../db/client';
import { campaigns, characters, gameSessions } from '../../../../db/schema/index';
import { getCampaignSessionNumbers } from '../../../../shared/campaign-session-numbers.js';

/**
 * The campaign-local session number, one rule for the list card and the chronicle eyebrow (#1592).
 *
 * It ranks only the user's own sessions in each campaign, by created_at. A session belongs to the
 * owner of its character; a session with no character belongs to the campaign's owner. RLS is off,
 * so this filter is the owner check.
 *
 * Kept out of session-service.ts on purpose: importing that module from the chronicles router pulls
 * its whole dependency graph into the CLI typecheck program (AGENTS.md section 11).
 */
export async function getOwnedCampaignSessionNumbers(
  campaignIds: readonly string[],
  userId: string,
): Promise<Map<string, number>> {
  const numbers = new Map<string, number>();
  if (campaignIds.length === 0) return numbers;

  const rows = await db
    .select({
      id: gameSessions.id,
      campaignId: gameSessions.campaignId,
      createdAt: gameSessions.createdAt,
    })
    .from(gameSessions)
    .leftJoin(characters, eq(characters.id, gameSessions.characterId))
    .leftJoin(campaigns, eq(campaigns.id, gameSessions.campaignId))
    .where(
      and(
        inArray(gameSessions.campaignId, [...campaignIds]),
        or(
          eq(characters.userId, userId),
          eq(characters.ownerId, userId),
          and(isNull(gameSessions.characterId), eq(campaigns.userId, userId)),
        ),
      ),
    );

  const byCampaign = new Map<string, Array<{ id: string; created_at: string | null }>>();
  for (const row of rows) {
    if (!row.campaignId) continue;
    const created =
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : row.createdAt
          ? String(row.createdAt)
          : null;
    const group = byCampaign.get(row.campaignId) ?? [];
    group.push({ id: row.id, created_at: created });
    byCampaign.set(row.campaignId, group);
  }
  for (const group of byCampaign.values()) {
    for (const [sessionId, number] of getCampaignSessionNumbers(group)) {
      numbers.set(sessionId, number);
    }
  }
  return numbers;
}
