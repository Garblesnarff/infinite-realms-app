import { and, eq, or } from 'drizzle-orm';

import { db } from '../../../../../db/client';
import {
  combatEncounters,
  gameSessions,
  campaigns,
  characters,
} from '../../../../../db/schema/index';

import type { CombatEncounter, GameSession } from '../../../../../db/schema/index';

export interface VerificationResult {
  success: boolean;
  encounter?: CombatEncounter;
  session?: GameSession;
  error?: { status: number; message: string };
}

/**
 * Verify that the user owns the encounter's session
 */
export async function verifyEncounterOwnership(
  encounterId: string | undefined,
  userId: string,
): Promise<VerificationResult> {
  if (!encounterId) {
    return { success: false, error: { status: 400, message: 'encounterId is required' } };
  }

  // ⚡ Bolt: Optimized to use a single joined Drizzle query instead of multiple round-trips
  // to CombatInitiativeService and Supabase JS client. Reduces latency for every combat request.
  const [result] = await db
    .select({
      encounter: combatEncounters,
      session: gameSessions,
      campaignOwnerId: campaigns.userId,
      characterUserId: characters.userId,
      characterOwnerId: characters.ownerId,
    })
    .from(combatEncounters)
    .innerJoin(gameSessions, eq(combatEncounters.sessionId, gameSessions.id))
    .leftJoin(campaigns, eq(gameSessions.campaignId, campaigns.id))
    .leftJoin(characters, eq(gameSessions.characterId, characters.id))
    .where(and(
      eq(combatEncounters.id, encounterId),
      or(
        eq(campaigns.userId, userId),
        eq(characters.userId, userId),
        eq(characters.ownerId, userId)
      )
    ))
    .limit(1);

  if (!result) {
    return { success: false, error: { status: 404, message: 'Encounter not found' } };
  }
  const { encounter, session } = result;
  return { success: true, encounter, session };
}

/**
 * Verify session ownership for starting combat
 */
export async function verifySessionOwnership(
  sessionId: string | undefined,
  userId: string,
): Promise<VerificationResult> {
  if (!sessionId) {
    return { success: false, error: { status: 400, message: 'sessionId is required' } };
  }

  // ⚡ Bolt: Optimized to use a joined Drizzle query instead of Supabase JS client.
  // This provides a consistent and faster way to verify ownership within the same DB transaction/pool.
  const [result] = await db
    .select({
      session: gameSessions,
      campaignOwnerId: campaigns.userId,
      characterUserId: characters.userId,
      characterOwnerId: characters.ownerId,
    })
    .from(gameSessions)
    .leftJoin(campaigns, eq(gameSessions.campaignId, campaigns.id))
    .leftJoin(characters, eq(gameSessions.characterId, characters.id))
    .where(and(
      eq(gameSessions.id, sessionId),
      or(
        eq(campaigns.userId, userId),
        eq(characters.userId, userId),
        eq(characters.ownerId, userId)
      )
    ))
    .limit(1);

  if (!result) {
    return { success: false, error: { status: 404, message: 'Session not found' } };
  }
  const { session } = result;
  return { success: true, session };
}
