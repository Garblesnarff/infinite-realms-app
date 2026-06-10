import { and, eq, or, exists, sql, type SQL } from 'drizzle-orm';

import { db } from '../../../../db/client';
import { gameSessions, campaigns, characters } from '../../../../db/schema/index';

/**
 * Helper to build ownership condition for a session.
 * Shared between SessionService and SessionMessageService.
 */
export function getOwnershipCondition(userId: string): SQL | undefined {
  return or(
    exists(
      db.select({ one: sql`1` })
        .from(campaigns)
        .where(and(
          eq(campaigns.id, gameSessions.campaignId),
          eq(campaigns.userId, userId)
        ))
    ),
    exists(
      db.select({ one: sql`1` })
        .from(characters)
        .where(and(
          eq(characters.id, gameSessions.characterId),
          or(
            eq(characters.userId, userId),
            eq(characters.ownerId, userId)
          )
        ))
    )
  );
}
