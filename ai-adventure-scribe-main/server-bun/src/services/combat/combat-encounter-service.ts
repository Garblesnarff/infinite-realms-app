/**
 * Combat Encounter Service
 *
 * Handles the lifecycle of combat encounters, including starting, ending,
 * and retrieving encounter state.
 *
 * Extracted from CombatInitiativeService.
 */

import { eq, and, sql, or } from 'drizzle-orm';

import {
  verifySessionAccess,
  verifyEncounterAccess,
  verifyCharactersAccessBatch,
  verifyNPCsAccessBatch,
} from './combat-authorization.js';
import { InitiativeMechanics, rollD20 } from './initiative-mechanics.js';
import { db } from '../../../../db/client';
import {
  combatEncounters,
  combatParticipants,
  gameSessions,
  campaigns,
  characters,
  type CombatEncounter,
  type CombatParticipant,
} from '../../../../db/schema/index';
import { NotFoundError, InternalServerError } from '../../lib/errors.js';

import type {
  CombatState,
  CreateParticipantInput,
  TurnOrderEntry,
} from '../../types/combat.js';

export class CombatEncounterService {
  /**
   * Start a new combat encounter
   * @param sessionId - Game session ID
   * @param participantInputs - Array of participants to add
   * @param surpriseRound - Whether this is a surprise round
   * @returns The created encounter with participants
   */
  static async startCombat(
    sessionId: string,
    participantInputs: CreateParticipantInput[],
    surpriseRound: boolean = false,
    userId?: string
  ): Promise<CombatState> {
    if (userId) {
      const characterIds = [
        ...new Set(
          participantInputs
            .map((input) => input.characterId)
            .filter((id): id is string => Boolean(id))
        ),
      ];
      const npcIds = [
        ...new Set(
          participantInputs
            .map((input) => input.npcId)
            .filter((id): id is string => Boolean(id))
        ),
      ];

      // ⚡ Bolt: Parallelize independent authorization checks to reduce database latency
      await Promise.all([
        verifySessionAccess(sessionId, userId),
        verifyCharactersAccessBatch(characterIds, userId),
        verifyNPCsAccessBatch(npcIds, userId),
      ]);
    }

    // Create the encounter
    const [encounter] = await db
      .insert(combatEncounters)
      .values({
        sessionId,
        status: 'active',
        currentRound: surpriseRound ? 0 : 1,
        currentTurnOrder: 0,
      })
      .returning();

    if (!encounter) {
      throw new InternalServerError('Failed to create combat encounter');
    }

    let participants: CombatParticipant[] = [];

    // Batch insert all participants (single query instead of N queries)
    if (participantInputs.length > 0) {
      // ⚡ Bolt: Calculate initiative and turn order in-memory to avoid redundant DB round-trips.
      const participantsWithInitiative = participantInputs.map(input => {
        const roll = rollD20();
        const initiative = InitiativeMechanics.calculateInitiative(roll, input.initiativeModifier);
        return {
          encounterId: encounter.id,
          characterId: input.characterId || null,
          npcId: input.npcId || null,
          name: input.name,
          initiative,
          initiativeModifier: input.initiativeModifier,
          participantType: input.characterId ? 'player' as const : input.npcId ? 'npc' as const : 'other' as const,
        };
      });

      // Sort by initiative (desc), then by modifier (desc) for ties to match calculateTurnOrder logic
      const sortedValues = InitiativeMechanics.sortParticipants(participantsWithInitiative);

      const participantValues = sortedValues.map((p, index) => ({
        ...p,
        turnOrder: index,
        isActive: true,
      }));

      const insertedParticipants = await db.insert(combatParticipants).values(participantValues).returning();
      // Ensure participants are sorted by turnOrder to match getCombatState behavior
      participants = insertedParticipants.sort((a, b) => a.turnOrder - b.turnOrder);
    }

    // ⚡ Bolt: Construct CombatState in-memory to avoid redundant fetch of just-inserted data.
    // This reduces database round-trips from 6 down to 3.
    const activeParticipants = participants.filter(p => p.isActive);
    const currentParticipant = activeParticipants[0] || null;

    const turnOrder: TurnOrderEntry[] = InitiativeMechanics.getTurnOrderEntries(
      activeParticipants,
      0,
      currentParticipant?.id || null
    );

    return {
      encounter: encounter as CombatEncounter,
      participants,
      turnOrder,
      currentParticipant,
    };
  }

  /**
   * End a combat encounter
   * @param encounterId - Combat encounter ID
   * @returns Updated encounter
   */
  static async endCombat(encounterId: string, userId?: string): Promise<CombatEncounter> {
    if (userId) {
      await verifyEncounterAccess(encounterId, userId);
    }

    const [updated] = await db
      .update(combatEncounters)
      .set({
        status: 'completed',
        endedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(combatEncounters.id, encounterId))
      .returning();

    if (!updated) {
      throw new NotFoundError('Combat encounter', encounterId);
    }

    return updated;
  }

  /**
   * Get complete combat state
   * @param encounterId - Combat encounter ID
   * @returns Complete combat state with participants and turn order
   */
  static async getCombatState(encounterId: string, userId?: string): Promise<CombatState> {
    if (userId) {
      await verifyEncounterAccess(encounterId, userId);
    }

    // Single relational query to fetch encounter and all participants
    const encounterWithParticipants = await db.query.combatEncounters.findFirst({
      where: (ce, { eq }) => eq(ce.id, encounterId),
      with: {
        participants: {
          orderBy: (cp, { asc }) => [asc(cp.turnOrder)],
        },
      },
    });

    if (!encounterWithParticipants) {
      throw new NotFoundError('Combat encounter', encounterId);
    }

    // Extract participants from the joined result
    const { participants, ...encounter } = encounterWithParticipants;

    // Filter active participants and determine current turn in-memory
    const activeParticipants = participants.filter(p => p.isActive);
    const currentParticipant = activeParticipants[encounter.currentTurnOrder] || null;

    // Build turn order entries in-memory
    const turnOrder: TurnOrderEntry[] = InitiativeMechanics.getTurnOrderEntries(
      activeParticipants,
      encounter.currentTurnOrder,
      currentParticipant?.id || null
    );

    return {
      encounter: encounter as CombatEncounter,
      participants,
      turnOrder,
      currentParticipant,
    };
  }

  /**
   * Get encounter by ID
   */
  static async getEncounterById(encounterId: string, userId?: string): Promise<CombatEncounter | undefined> {
    if (userId) {
      const [result] = await db
        .select({ encounter: combatEncounters })
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

      return result?.encounter;
    }

    return await db.query.combatEncounters.findFirst({
      where: (ce, { eq }) => eq(ce.id, encounterId),
    });
  }

  /**
   * Get active encounter for a session
   */
  static async getActiveEncounter(sessionId: string, userId?: string): Promise<CombatEncounter | undefined> {
    if (userId) {
      const [result] = await db
        .select({ encounter: combatEncounters })
        .from(combatEncounters)
        .innerJoin(gameSessions, eq(combatEncounters.sessionId, gameSessions.id))
        .leftJoin(campaigns, eq(gameSessions.campaignId, campaigns.id))
        .leftJoin(characters, eq(gameSessions.characterId, characters.id))
        .where(and(
          eq(combatEncounters.sessionId, sessionId),
          eq(combatEncounters.status, 'active'),
          or(
            eq(campaigns.userId, userId),
            eq(characters.userId, userId),
            eq(characters.ownerId, userId)
          )
        ))
        .limit(1);

      return result?.encounter;
    }

    return await db.query.combatEncounters.findFirst({
      where: (ce, { eq, and }) => and(
        eq(ce.sessionId, sessionId),
        eq(ce.status, 'active')
      ),
    });
  }
}
