/**
 * Combat Authorization Module
 *
 * Extracted from CombatInitiativeService.
 * Handles ownership and access verification for combat-related resources.
 *
 * @module server/services/combat/combat-authorization
 */

import { eq, and, or, inArray } from 'drizzle-orm';

import { db } from '../../../../db/client';
import {
  combatEncounters,
  combatParticipants,
  gameSessions,
  campaigns,
  characters,
  characterPermissions,
  npcs,
} from '../../../../db/schema/index';
import { NotFoundError } from '../../lib/errors.js';

/**
 * Verify session ownership through campaign/character links.
 * Throws NOT_FOUND for both missing and unauthorized access.
 */
export async function verifySessionAccess(sessionId: string, userId: string): Promise<void> {
  const [result] = await db
    .select({ id: gameSessions.id })
    .from(gameSessions)
    .leftJoin(campaigns, eq(gameSessions.campaignId, campaigns.id))
    .leftJoin(characters, eq(gameSessions.characterId, characters.id))
    .leftJoin(characterPermissions, and(
      eq(characterPermissions.characterId, characters.id),
      eq(characterPermissions.userId, userId),
    ))
    .where(and(
      eq(gameSessions.id, sessionId),
      or(
        eq(campaigns.userId, userId),
        eq(characters.userId, userId),
        eq(characters.ownerId, userId),
        eq(characterPermissions.userId, userId)
      )
    ))
    .limit(1);

  if (!result) {
    throw new NotFoundError('Session', sessionId);
  }
}

/**
 * Verify encounter ownership through its session's campaign/character links.
 * Throws NOT_FOUND for both missing and unauthorized access.
 */
export async function verifyEncounterAccess(encounterId: string, userId: string): Promise<void> {
  const [result] = await db
    .select({ id: combatEncounters.id })
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
    throw new NotFoundError('Combat encounter', encounterId);
  }
}

/**
 * Verify character ownership through user_id/owner_id.
 * Throws NOT_FOUND for both missing and unauthorized access.
 */
export async function verifyCharacterAccess(characterId: string, userId: string): Promise<void> {
  const [result] = await db
    .select({ id: characters.id })
    .from(characters)
    .where(and(
      eq(characters.id, characterId),
      or(
        eq(characters.userId, userId),
        eq(characters.ownerId, userId)
      )
    ))
    .limit(1);

  if (!result) {
    throw new NotFoundError('Character', characterId);
  }
}

/**
 * ⚡ Bolt: Verify multiple characters' ownership in a single batch query.
 * Prevents N+1 database round-trips during combat initialization.
 */
export async function verifyCharactersAccessBatch(characterIds: string[], userId: string): Promise<void> {
  if (characterIds.length === 0) return;

  const results = await db
    .select({ id: characters.id })
    .from(characters)
    .where(and(
      inArray(characters.id, characterIds),
      or(
        eq(characters.userId, userId),
        eq(characters.ownerId, userId)
      )
    ));

  if (results.length !== characterIds.length) {
    const foundIds = new Set(results.map(r => r.id));
    for (const id of characterIds) {
      if (!foundIds.has(id)) {
        throw new NotFoundError('Character', id);
      }
    }
  }
}

/**
 * 🛡️ Sentinel: Verify NPC ownership through its campaign's user_id.
 * Throws NOT_FOUND for both missing and unauthorized access.
 */
export async function verifyNPCAccess(npcId: string, userId: string): Promise<void> {
  const [result] = await db
    .select({ id: npcs.id })
    .from(npcs)
    .innerJoin(campaigns, eq(npcs.campaignId, campaigns.id))
    .where(and(
      eq(npcs.id, npcId),
      eq(campaigns.userId, userId)
    ))
    .limit(1);

  if (!result) {
    throw new NotFoundError('NPC', npcId);
  }
}

/**
 * 🛡️ Sentinel: Verify multiple NPCs' ownership in a single batch query.
 * Prevents N+1 database round-trips during combat initialization.
 */
export async function verifyNPCsAccessBatch(npcIds: string[], userId: string): Promise<void> {
  if (npcIds.length === 0) return;

  const results = await db
    .select({ id: npcs.id })
    .from(npcs)
    .innerJoin(campaigns, eq(npcs.campaignId, campaigns.id))
    .where(and(
      inArray(npcs.id, npcIds),
      eq(campaigns.userId, userId)
    ));

  if (results.length !== npcIds.length) {
    const foundIds = new Set(results.map(r => r.id));
    for (const id of npcIds) {
      if (!foundIds.has(id)) {
        throw new NotFoundError('NPC', id);
      }
    }
  }
}

/**
 * 🛡️ Sentinel: Verify user owns the specific participant.
 * A user owns a participant if:
 * 1. They are the DM of the campaign (owns the NPC or any character in the campaign)
 * 2. They own the specific character linked to the participant.
 * Throws NOT_FOUND for both missing and unauthorized access.
 */
export async function verifyParticipantOwnership(
  participantId: string,
  encounterId: string,
  userId: string
): Promise<void> {
  const [result] = await db
    .select({ id: combatParticipants.id })
    .from(combatParticipants)
    .innerJoin(combatEncounters, eq(combatParticipants.encounterId, combatEncounters.id))
    .innerJoin(gameSessions, eq(combatEncounters.sessionId, gameSessions.id))
    .leftJoin(campaigns, eq(gameSessions.campaignId, campaigns.id))
    .leftJoin(characters, eq(combatParticipants.characterId, characters.id))
    .where(and(
      eq(combatParticipants.id, participantId),
      eq(combatParticipants.encounterId, encounterId),
      or(
        eq(campaigns.userId, userId), // DM can act as anyone in the campaign
        eq(characters.userId, userId), // Player can act as their own character
        eq(characters.ownerId, userId)
      )
    ))
    .limit(1);

  if (!result) {
    throw new NotFoundError('Participant', participantId);
  }
}
