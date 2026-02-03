import { eq } from 'drizzle-orm';

import { db } from '../../../db/client.js';
import {
  combatEncounters,
  gameSessions,
  campaigns,
  characters,
} from '../../../db/schema/index.js';

import type { CombatEncounter, GameSession } from '../../../db/schema/index.js';

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
  userId: string
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
      characterOwnerId: characters.userId,
    })
    .from(combatEncounters)
    .innerJoin(gameSessions, eq(combatEncounters.sessionId, gameSessions.id))
    .leftJoin(campaigns, eq(gameSessions.campaignId, campaigns.id))
    .leftJoin(characters, eq(gameSessions.characterId, characters.id))
    .where(eq(combatEncounters.id, encounterId))
    .limit(1);

  if (!result) {
    return { success: false, error: { status: 404, message: 'Encounter not found' } };
  }

  const { encounter, session, campaignOwnerId, characterOwnerId } = result;

  if (campaignOwnerId !== userId && characterOwnerId !== userId) {
    return { success: false, error: { status: 403, message: 'Access denied' } };
  }

  return { success: true, encounter, session };
}

/**
 * Verify session ownership for starting combat
 */
export async function verifySessionOwnership(
  sessionId: string | undefined,
  userId: string
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
      characterOwnerId: characters.userId,
    })
    .from(gameSessions)
    .leftJoin(campaigns, eq(gameSessions.campaignId, campaigns.id))
    .leftJoin(characters, eq(gameSessions.characterId, characters.id))
    .where(eq(gameSessions.id, sessionId))
    .limit(1);

  if (!result) {
    return { success: false, error: { status: 404, message: 'Session not found' } };
  }

  const { session, campaignOwnerId, characterOwnerId } = result;

  if (campaignOwnerId !== userId && characterOwnerId !== userId) {
    return { success: false, error: { status: 403, message: 'Access denied' } };
  }

  return { success: true, session };
}
