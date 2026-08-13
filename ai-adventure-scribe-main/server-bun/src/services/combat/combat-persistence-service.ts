/* eslint-disable max-lines */
import { and, desc, eq, exists, inArray, or, sql, type SQL } from 'drizzle-orm';

import { db } from '../../../../db/client';
import {
  campaigns,
  characters,
  combatDamageLog,
  combatEncounters,
  combatParticipantConditions,
  combatParticipantStatus,
  combatParticipants,
  conditionsLibrary,
  gameSessions,
  npcs,
} from '../../../../db/schema/index';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { getOwnershipCondition } from '../session/session-authorization.js';

export type CombatPersistenceState = 'active' | 'paused' | 'completed';

export interface CombatPersistenceParticipant {
  id: string;
  characterId: string | null;
  npcId: string | null;
  name: string;
  participantType: 'player' | 'npc' | 'enemy' | 'monster';
  initiative: number;
  initiativeModifier: number;
  turnOrder: number;
  isActive: boolean;
  armorClass: number;
  maxHp: number;
  speed: number;
  damageResistances: string[];
  damageImmunities: string[];
  damageVulnerabilities: string[];
}

export interface CombatPersistenceStatus {
  participantId: string;
  currentHp: number;
  maxHp: number;
  tempHp: number;
  isConscious: boolean;
  deathSavesSuccesses: number;
  deathSavesFailures: number;
}

export interface CombatPersistenceCondition {
  participantId: string;
  conditionName: string;
  durationRounds: number | null;
  source: string | null;
}

export interface CombatPersistenceInput {
  sessionId: string;
  status: CombatPersistenceState;
  currentRound: number;
  currentTurnOrder: number;
  location: string | null;
  startedAt: string;
  participants: CombatPersistenceParticipant[];
  statuses: CombatPersistenceStatus[];
  conditions: CombatPersistenceCondition[];
}

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

function parseTimestamp(value: string, field: string): Date {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new ValidationError(`${field} must be a valid ISO timestamp`);
  }
  return parsed;
}

function mapPersistenceStatus(status: CombatPersistenceState): 'active' | 'paused' | 'completed' {
  return status;
}

function excluded(column: string): SQL<unknown> {
  // The column names are fixed by this module; no request data reaches sql.raw().
  return sql.raw(`excluded.${column}`);
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
 * Persist the legacy browser combat snapshot behind one ownership-scoped transaction.
 *
 * The client supplies an encounter id because the legacy context creates it locally. The
 * server only accepts it for an owned session and refuses to move an existing encounter or
 * participant to another session.
 */
export async function saveCombatPersistence(
  encounterId: string,
  input: CombatPersistenceInput,
  userId: string,
): Promise<{
  encounterId: string;
  participants: number;
  statuses: number;
  conditions: number;
  skippedConditions: string[];
}> {
  const startedAt = parseTimestamp(input.startedAt, 'startedAt');
  const allReferencedParticipantIds = [
    ...input.participants.map((participant) => participant.id),
    ...input.statuses.map((status) => status.participantId),
    ...input.conditions.map((condition) => condition.participantId),
  ];
  const uniqueReferencedParticipantIds = [...new Set(allReferencedParticipantIds)];
  const inputParticipantIds = new Set(input.participants.map((participant) => participant.id));
  const statusParticipantIds = new Set(input.statuses.map((status) => status.participantId));

  if (inputParticipantIds.size !== input.participants.length) {
    throw new ValidationError('participants must not contain duplicate ids');
  }

  if (statusParticipantIds.size !== input.statuses.length) {
    throw new ValidationError('statuses must not contain duplicate participant ids');
  }

  if (input.participants.some((participant) => participant.characterId && participant.npcId)) {
    throw new ValidationError('a combat participant cannot reference both a character and an NPC');
  }

  if (input.statuses.some((status) => !Number.isInteger(status.currentHp))) {
    throw new ValidationError('combat participant currentHp values must be integers');
  }

  return db.transaction(async (tx) => {
    const session = await tx.query.gameSessions.findFirst({
      where: (gameSession) =>
        and(eq(gameSession.id, input.sessionId), getOwnershipCondition(userId, gameSession)),
      columns: { id: true },
    });

    if (!session) {
      throw new NotFoundError('Session', input.sessionId);
    }

    const [existingEncounter] = await tx
      .select({ id: combatEncounters.id, sessionId: combatEncounters.sessionId })
      .from(combatEncounters)
      .where(eq(combatEncounters.id, encounterId))
      .limit(1);

    if (existingEncounter && existingEncounter.sessionId !== input.sessionId) {
      throw new NotFoundError('Encounter', encounterId);
    }

    const encounterValues = {
      status: mapPersistenceStatus(input.status),
      currentRound: input.currentRound,
      currentTurnOrder: input.currentTurnOrder,
      location: input.location ?? null,
      startedAt,
      updatedAt: new Date(),
    };

    if (existingEncounter) {
      await tx
        .update(combatEncounters)
        .set(encounterValues)
        .where(eq(combatEncounters.id, encounterId));
    } else {
      await tx.insert(combatEncounters).values({
        id: encounterId,
        sessionId: input.sessionId,
        ...encounterValues,
      });
    }

    const existingParticipants = uniqueReferencedParticipantIds.length
      ? await tx
          .select({ id: combatParticipants.id, encounterId: combatParticipants.encounterId })
          .from(combatParticipants)
          .where(inArray(combatParticipants.id, uniqueReferencedParticipantIds))
      : [];
    const existingParticipantIds = new Set(
      existingParticipants.map((participant) => participant.id),
    );

    if (existingParticipants.some((participant) => participant.encounterId !== encounterId)) {
      throw new NotFoundError('Encounter', encounterId);
    }

    if (
      uniqueReferencedParticipantIds.some(
        (participantId) =>
          !inputParticipantIds.has(participantId) && !existingParticipantIds.has(participantId),
      )
    ) {
      throw new NotFoundError('Participant');
    }

    const characterIds = [
      ...new Set(
        input.participants
          .map((participant) => participant.characterId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    if (characterIds.length > 0) {
      const ownedCharacters = await tx
        .select({ id: characters.id })
        .from(characters)
        .where(
          and(
            inArray(characters.id, characterIds),
            or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
          ),
        );
      if (ownedCharacters.length !== characterIds.length) {
        throw new NotFoundError('Character');
      }
    }

    const npcIds = [
      ...new Set(
        input.participants
          .map((participant) => participant.npcId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    if (npcIds.length > 0) {
      const ownedNpcs = await tx
        .select({ id: npcs.id })
        .from(npcs)
        .innerJoin(campaigns, eq(npcs.campaignId, campaigns.id))
        .where(and(inArray(npcs.id, npcIds), eq(campaigns.userId, userId)));
      if (ownedNpcs.length !== npcIds.length) {
        throw new NotFoundError('NPC');
      }
    }

    if (input.participants.length > 0) {
      await tx
        .insert(combatParticipants)
        .values(
          input.participants.map((participant) => ({
            id: participant.id,
            encounterId,
            characterId: participant.characterId,
            npcId: participant.npcId,
            name: participant.name,
            participantType: participant.participantType,
            initiative: participant.initiative,
            initiativeModifier: participant.initiativeModifier,
            turnOrder: participant.turnOrder,
            isActive: participant.isActive,
            armorClass: participant.armorClass,
            maxHp: participant.maxHp,
            speed: participant.speed,
            damageResistances: participant.damageResistances,
            damageImmunities: participant.damageImmunities,
            damageVulnerabilities: participant.damageVulnerabilities,
            updatedAt: new Date(),
          })),
        )
        .onConflictDoUpdate({
          target: combatParticipants.id,
          set: {
            characterId: excluded('character_id'),
            npcId: excluded('npc_id'),
            name: excluded('name'),
            participantType: excluded('participant_type'),
            initiative: excluded('initiative'),
            initiativeModifier: excluded('initiative_modifier'),
            turnOrder: excluded('turn_order'),
            isActive: excluded('is_active'),
            armorClass: excluded('armor_class'),
            maxHp: excluded('max_hp'),
            speed: excluded('speed'),
            damageResistances: excluded('damage_resistances'),
            damageImmunities: excluded('damage_immunities'),
            damageVulnerabilities: excluded('damage_vulnerabilities'),
            updatedAt: excluded('updated_at'),
          },
        });
    }

    if (input.statuses.length > 0) {
      await tx
        .insert(combatParticipantStatus)
        .values(
          input.statuses.map((status) => ({
            participantId: status.participantId,
            currentHp: status.currentHp,
            maxHp: status.maxHp,
            tempHp: status.tempHp,
            isConscious: status.isConscious,
            deathSavesSuccesses: status.deathSavesSuccesses,
            deathSavesFailures: status.deathSavesFailures,
            updatedAt: new Date(),
          })),
        )
        .onConflictDoUpdate({
          target: combatParticipantStatus.participantId,
          set: {
            currentHp: excluded('current_hp'),
            maxHp: excluded('max_hp'),
            tempHp: excluded('temp_hp'),
            isConscious: excluded('is_conscious'),
            deathSavesSuccesses: excluded('death_saves_successes'),
            deathSavesFailures: excluded('death_saves_failures'),
            updatedAt: excluded('updated_at'),
          },
        });
    }

    if (inputParticipantIds.size > 0) {
      await tx
        .delete(combatParticipantConditions)
        .where(inArray(combatParticipantConditions.participantId, [...inputParticipantIds]));
    }

    const conditionNames = [
      ...new Set(input.conditions.map((condition) => condition.conditionName.toLowerCase())),
    ];
    const conditionRows = conditionNames.length
      ? await tx
          .select({ id: conditionsLibrary.id, name: conditionsLibrary.name })
          .from(conditionsLibrary)
          .where(
            or(...conditionNames.map((name) => sql`lower(${conditionsLibrary.name}) = ${name}`)),
          )
      : [];
    const conditionIds = new Map(
      conditionRows.map((condition) => [condition.name.toLowerCase(), condition.id]),
    );
    const skippedConditions = [
      ...new Set(
        input.conditions
          .filter((condition) => !conditionIds.has(condition.conditionName.toLowerCase()))
          .map((condition) => condition.conditionName),
      ),
    ];
    const conditionValues = input.conditions.flatMap((condition) => {
      const conditionId = conditionIds.get(condition.conditionName.toLowerCase());
      if (!conditionId) return [];
      const durationRounds = condition.durationRounds ?? null;
      return [
        {
          participantId: condition.participantId,
          conditionId,
          durationType: durationRounds === null ? 'permanent' : 'rounds',
          durationValue: durationRounds,
          appliedAtRound: input.currentRound,
          expiresAtRound: durationRounds === null ? null : input.currentRound + durationRounds,
          sourceDescription: condition.source ?? null,
          isActive: true,
        },
      ];
    });
    if (conditionValues.length > 0) {
      await tx.insert(combatParticipantConditions).values(conditionValues);
    }

    return {
      encounterId,
      participants: input.participants.length,
      statuses: input.statuses.length,
      conditions: conditionValues.length,
      skippedConditions,
    };
  });
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
