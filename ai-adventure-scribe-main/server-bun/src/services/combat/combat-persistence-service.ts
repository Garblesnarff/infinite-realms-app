/* eslint-disable max-lines */
import { and, desc, eq, exists, or, sql, type SQL } from 'drizzle-orm';

import { db } from '../../../../db/client';
import {
  campaigns,
  characters,
  combatDamageLog,
  combatEncounters,
  combatParticipantStatus,
  combatParticipants,
  gameSessions,
} from '../../../../db/schema/index';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { getOwnershipCondition } from '../session/session-authorization.js';

export interface CombatParticipantStatusUpdate {
  currentHp?: number;
  tempHp?: number;
  isConscious?: boolean;
  deathSavesSuccesses?: number;
  deathSavesFailures?: number;
}

export interface CombatDamageLogInput {
  participantId: string;
  damageAmount: number;
  damageType: string;
  sourceParticipantId: string | null;
  sourceDescription: string | null;
  roundNumber: number;
}

export interface CombatParticipantStatusView {
  participant_id: string;
  encounter_id: string;
  current_hp: number;
  max_hp: number;
  temp_hp: number;
  is_conscious: boolean;
  death_saves_successes: number;
  death_saves_failures: number;
  damage_resistances: string[];
  damage_immunities: string[];
  damage_vulnerabilities: string[];
}

function statusView(
  participant: typeof combatParticipants.$inferSelect,
  status: typeof combatParticipantStatus.$inferSelect,
): CombatParticipantStatusView {
  return {
    participant_id: participant.id,
    encounter_id: participant.encounterId,
    current_hp: status.currentHp,
    max_hp: status.maxHp,
    temp_hp: status.tempHp,
    is_conscious: status.isConscious,
    death_saves_successes: status.deathSavesSuccesses,
    death_saves_failures: status.deathSavesFailures,
    damage_resistances: participant.damageResistances ?? [],
    damage_immunities: participant.damageImmunities ?? [],
    damage_vulnerabilities: participant.damageVulnerabilities ?? [],
  };
}

function participantStatusOwnershipCondition(participantId: string, userId: string): SQL<unknown> {
  return exists(
    db
      .select({ one: sql`1` })
      .from(combatParticipants)
      .innerJoin(combatEncounters, eq(combatParticipants.encounterId, combatEncounters.id))
      .innerJoin(gameSessions, eq(combatEncounters.sessionId, gameSessions.id))
      .leftJoin(campaigns, eq(gameSessions.campaignId, campaigns.id))
      .leftJoin(characters, eq(gameSessions.characterId, characters.id))
      .where(
        and(
          eq(combatParticipants.id, participantId),
          or(
            eq(campaigns.userId, userId),
            eq(characters.userId, userId),
            eq(characters.ownerId, userId),
          ),
        ),
      ),
  );
}

/**
 * Append a damage log row for an owned encounter.
 *
 * The browser used to insert this row directly with the Supabase anon key. Keep the
 * encounter, target participant, and optional source participant on the same encounter so
 * the authenticated route cannot be used to write cross-session combat history.
 */
export async function recordCombatDamageLog(
  encounterId: string,
  input: CombatDamageLogInput,
  userId: string,
): Promise<{ id: string }> {
  const [ownedEncounter] = await db
    .select({ id: combatEncounters.id })
    .from(combatEncounters)
    .innerJoin(gameSessions, eq(combatEncounters.sessionId, gameSessions.id))
    .where(and(eq(combatEncounters.id, encounterId), getOwnershipCondition(userId, gameSessions)))
    .limit(1);

  if (!ownedEncounter) {
    throw new NotFoundError('Encounter', encounterId);
  }

  const [participant] = await db
    .select({ id: combatParticipants.id })
    .from(combatParticipants)
    .where(
      and(
        eq(combatParticipants.id, input.participantId),
        eq(combatParticipants.encounterId, encounterId),
      ),
    )
    .limit(1);

  if (!participant) {
    throw new NotFoundError('Participant', input.participantId);
  }

  if (input.sourceParticipantId) {
    const [sourceParticipant] = await db
      .select({ id: combatParticipants.id })
      .from(combatParticipants)
      .where(
        and(
          eq(combatParticipants.id, input.sourceParticipantId),
          eq(combatParticipants.encounterId, encounterId),
        ),
      )
      .limit(1);

    if (!sourceParticipant) {
      throw new NotFoundError('Source participant', input.sourceParticipantId);
    }
  }

  const [log] = await db
    .insert(combatDamageLog)
    .values({
      encounterId,
      participantId: input.participantId,
      damageAmount: input.damageAmount,
      damageType: input.damageType,
      sourceParticipantId: input.sourceParticipantId,
      sourceDescription: input.sourceDescription,
      roundNumber: input.roundNumber,
    })
    .returning({ id: combatDamageLog.id });

  if (!log) {
    throw new NotFoundError('Damage log');
  }

  return log;
}

export async function getCombatParticipantStatus(
  participantId: string,
  userId: string,
): Promise<CombatParticipantStatusView> {
  const [result] = await db
    .select({
      participant: combatParticipants,
      status: combatParticipantStatus,
    })
    .from(combatParticipants)
    .innerJoin(
      combatParticipantStatus,
      eq(combatParticipantStatus.participantId, combatParticipants.id),
    )
    .innerJoin(combatEncounters, eq(combatParticipants.encounterId, combatEncounters.id))
    .innerJoin(gameSessions, eq(combatEncounters.sessionId, gameSessions.id))
    .leftJoin(campaigns, eq(gameSessions.campaignId, campaigns.id))
    .leftJoin(characters, eq(gameSessions.characterId, characters.id))
    .where(
      and(
        eq(combatParticipants.id, participantId),
        or(
          eq(campaigns.userId, userId),
          eq(characters.userId, userId),
          eq(characters.ownerId, userId),
        ),
      ),
    )
    .limit(1);

  if (!result) throw new NotFoundError('Participant', participantId);
  return statusView(result.participant, result.status);
}

export async function getCharacterCombatStatus(
  characterId: string,
  userId: string,
): Promise<CombatParticipantStatusView | null> {
  const [ownedCharacter] = await db
    .select({ id: characters.id })
    .from(characters)
    .where(
      and(
        eq(characters.id, characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
      ),
    )
    .limit(1);
  if (!ownedCharacter) throw new NotFoundError('Character', characterId);

  const [result] = await db
    .select({
      participant: combatParticipants,
      status: combatParticipantStatus,
    })
    .from(combatParticipants)
    .innerJoin(
      combatParticipantStatus,
      eq(combatParticipantStatus.participantId, combatParticipants.id),
    )
    .where(
      and(eq(combatParticipants.characterId, characterId), eq(combatParticipants.isActive, true)),
    )
    .orderBy(desc(combatParticipants.createdAt))
    .limit(1);

  return result ? statusView(result.participant, result.status) : null;
}

export async function updateCombatParticipantStatus(
  participantId: string,
  updates: CombatParticipantStatusUpdate,
  userId: string,
): Promise<CombatParticipantStatusView> {
  if (Object.keys(updates).length === 0) {
    throw new ValidationError('At least one combat participant status field is required');
  }

  // A patch that takes a character to 0 HP is damage, and damage has one dying transition:
  // the same rules, state change and engine line as any other writer (#2518, #2622). The raw
  // columns it carried (HP, consciousness, tallies) are the transition's to set, not the client's.
  const dropsToZero = updates.currentHp === 0;
  if (dropsToZero) {
    const [live] = await db
      .select({
        characterId: combatParticipants.characterId,
        currentHp: combatParticipantStatus.currentHp,
        tempHp: combatParticipantStatus.tempHp,
      })
      .from(combatParticipants)
      .innerJoin(
        combatParticipantStatus,
        eq(combatParticipantStatus.participantId, combatParticipants.id),
      )
      .where(
        and(
          eq(combatParticipants.id, participantId),
          participantStatusOwnershipCondition(participantId, userId),
        ),
      )
      .limit(1);
    if (live?.characterId && live.currentHp > 0) {
      const { applyNonAttackDamage } = await import('./non-attack-damage.js');
      await applyNonAttackDamage(
        live.characterId,
        userId,
        live.currentHp + live.tempHp,
        'status patch',
      );
      const {
        currentHp: _hp,
        isConscious: _c,
        deathSavesSuccesses: _s,
        deathSavesFailures: _f,
        ...rest
      } = updates;
      if (Object.keys(rest).length === 0) return getCombatParticipantStatus(participantId, userId);
      updates = rest;
    }
  }

  const values: {
    currentHp?: number;
    tempHp?: number;
    isConscious?: boolean;
    deathSavesSuccesses?: number;
    deathSavesFailures?: number;
    updatedAt: Date;
  } = { updatedAt: new Date() };
  if (updates.currentHp !== undefined) values.currentHp = updates.currentHp;
  if (updates.tempHp !== undefined) values.tempHp = updates.tempHp;
  if (updates.isConscious !== undefined) values.isConscious = updates.isConscious;
  if (updates.deathSavesSuccesses !== undefined) {
    values.deathSavesSuccesses = updates.deathSavesSuccesses;
  }
  if (updates.deathSavesFailures !== undefined) {
    values.deathSavesFailures = updates.deathSavesFailures;
  }

  const [updated] = await db
    .update(combatParticipantStatus)
    .set(values)
    .where(
      and(
        eq(combatParticipantStatus.participantId, participantId),
        participantStatusOwnershipCondition(participantId, userId),
      ),
    )
    .returning();
  if (!updated) throw new NotFoundError('Participant', participantId);

  return getCombatParticipantStatus(participantId, userId);
}
