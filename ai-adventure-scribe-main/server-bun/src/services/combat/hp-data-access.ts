/**
 * HP Data Access Module
 *
 * All database queries for the combat HP system:
 * - Participant/creature status fetching
 * - Damage log retrieval
 * - Status initialization
 *
 * @module server/services/combat/hp-data-access
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, desc, eq, exists, or } from 'drizzle-orm';

import { verifyEncounterAccess } from './data-access.js';
import { db } from '../../../../db/client';
import {
  combatParticipants,
  combatParticipantStatus,
  combatDamageLog,
  combatEncounters,
  gameSessions,
  campaigns,
  characters,
} from '../../../../db/schema/index';
import { NotFoundError } from '../../lib/errors.js';

import type {
  CombatParticipant,
  CombatParticipantStatus,
  CombatDamageLog,
} from '../../../../db/schema/index';

/**
 * Get participant with full context (status, encounter, and authorization) in a single query.
 * ⚡ Bolt: Consolidated 2-3 query patterns into one round-trip.
 */
export async function getParticipantWithFullContext(
  participantId: string,
  encounterId: string,
  userId?: string
): Promise<{ participant: CombatParticipant; status: CombatParticipantStatus; currentRound: number }> {
  const [result] = await (db as any)
    .select({
      participant: combatParticipants,
      status: combatParticipantStatus,
      currentRound: combatEncounters.currentRound,
    })
    .from(combatParticipants)
    .innerJoin(combatParticipantStatus, eq(combatParticipantStatus.participantId, combatParticipants.id))
    .innerJoin(combatEncounters, eq(combatParticipants.encounterId, combatEncounters.id))
    .where(and(
      eq(combatParticipants.id, participantId),
      eq(combatParticipants.encounterId, encounterId),
      userId
        ? exists(
            db.select()
              .from(gameSessions)
              .leftJoin(campaigns, eq(gameSessions.campaignId, campaigns.id))
              .leftJoin(characters, eq(gameSessions.characterId, characters.id))
              .where(and(
                eq(gameSessions.id, combatEncounters.sessionId),
                or(
                  eq(campaigns.userId, userId),
                  eq(characters.userId, userId),
                  eq(characters.ownerId, userId)
                )
              ))
          )
        : undefined
    ))
    .limit(1);

  if (!result) {
    throw new NotFoundError('Participant', participantId);
  }

  return result;
}

/**
 * Fetch participant status, optionally scoped by user ownership.
 * When userId is provided, unauthorized and missing participants both return null.
 */
export async function getParticipantStatusScoped(
  participantId: string,
  userId?: string
): Promise<{ encounterId: string; status: CombatParticipantStatus | null } | null> {
  if (userId) {
    const [scopedParticipant] = await (db as any)
      .select({
        encounterId: combatParticipants.encounterId,
        status: combatParticipantStatus,
      })
      .from(combatParticipants)
      .leftJoin(combatParticipantStatus, eq(combatParticipantStatus.participantId, combatParticipants.id))
      .innerJoin(combatEncounters, eq(combatParticipants.encounterId, combatEncounters.id))
      .innerJoin(gameSessions, eq(combatEncounters.sessionId, gameSessions.id))
      .leftJoin(campaigns, eq(gameSessions.campaignId, campaigns.id))
      .leftJoin(characters, eq(gameSessions.characterId, characters.id))
      .where(and(
        eq(combatParticipants.id, participantId),
        or(
          eq(campaigns.userId, userId),
          eq(characters.userId, userId),
          eq(characters.ownerId, userId)
        )
      ))
      .limit(1);

    if (!scopedParticipant) {
      return null;
    }

    return {
      encounterId: scopedParticipant.encounterId,
      status: scopedParticipant.status,
    };
  }

  const participant = await db.query.combatParticipants.findFirst({
    where: eq(combatParticipants.id, participantId),
    with: {
      status: true,
    },
  });

  if (!participant) {
    return null;
  }

  return {
    encounterId: participant.encounterId,
    status: participant.status || null,
  };
}

/**
 * Get damage log for an encounter or specific participant.
 * ⚡ Bolt: Consolidated authorization and data retrieval into a single query.
 */
export async function getDamageLog(
  encounterId: string,
  participantId?: string,
  round?: number,
  userId?: string
): Promise<CombatDamageLog[]> {
  const conditions = [eq(combatDamageLog.encounterId, encounterId)];

  if (participantId) {
    conditions.push(eq(combatDamageLog.participantId, participantId));
  }

  if (round !== undefined) {
    conditions.push(eq(combatDamageLog.roundNumber, round));
  }

  if (userId) {
    const results = await (db as any)
      .select({ log: combatDamageLog })
      .from(combatDamageLog)
      .innerJoin(combatEncounters, eq(combatDamageLog.encounterId, combatEncounters.id))
      .innerJoin(gameSessions, eq(combatEncounters.sessionId, gameSessions.id))
      .leftJoin(campaigns, eq(gameSessions.campaignId, campaigns.id))
      .leftJoin(characters, eq(gameSessions.characterId, characters.id))
      .where(and(
        ...conditions,
        or(
          eq(campaigns.userId, userId),
          eq(characters.userId, userId),
          eq(characters.ownerId, userId)
        )
      ))
      .orderBy(desc(combatDamageLog.createdAt));

    // If results are empty, verify encounter access to maintain standard error behavior (masking)
    if (results.length === 0) {
      await verifyEncounterAccess(encounterId, userId);
    }

    return results.map((r: any) => r.log);
  }

  const logs = await db.query.combatDamageLog.findMany({
    where: conditions.length > 1 ? and(...conditions) : conditions[0],
    orderBy: [desc(combatDamageLog.createdAt)],
  });

  return logs;
}

/**
 * Get participant status
 */
export async function getParticipantStatus(
  participantId: string,
  userId?: string
): Promise<CombatParticipantStatus | null> {
  const participant = await getParticipantStatusScoped(participantId, userId);

  if (!participant) {
    return null;
  }

  return participant.status || null;
}

/**
 * Initialize status for a new participant
 */
export async function initializeParticipantStatus(
  participantId: string,
  maxHp: number,
  currentHp?: number
): Promise<CombatParticipantStatus> {
  const [status] = await db
    .insert(combatParticipantStatus)
    .values({
      participantId,
      maxHp,
      currentHp: currentHp !== undefined ? currentHp : maxHp,
      tempHp: 0,
      isConscious: true,
      deathSavesSuccesses: 0,
      deathSavesFailures: 0,
    })
    .returning();

  if (!status) {
    throw new NotFoundError('Failed to initialize participant status', participantId);
  }

  return status;
}
