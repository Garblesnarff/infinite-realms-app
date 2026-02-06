/**
 * Combat Initiative Service
 *
 * Type-safe combat initiative and turn order management for D&D 5E combat.
 * Handles encounter lifecycle, initiative rolls, and turn advancement.
 */

import { eq, and, sql } from 'drizzle-orm';

import { db } from '../../../db/client.js';
import {
  combatEncounters,
  combatParticipants,
  type CombatEncounter,
  type CombatParticipant,
} from '../../../db/schema/index.js';
import { NotFoundError, InternalServerError, BusinessLogicError } from '../lib/errors.js';

import type {
  CombatState,
  CreateParticipantInput,
  InitiativeRoll,
  TurnOrderEntry,
  AdvanceTurnResult,
} from '../types/combat.js';

/**
 * Roll a d20 for initiative
 */
function rollD20(): number {
  return Math.floor(Math.random() * 20) + 1;
}

/**
 * Combat Initiative Service
 * Provides type-safe database operations for combat encounters
 */
export class CombatInitiativeService {
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
    surpriseRound: boolean = false
  ): Promise<CombatState> {
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

    // Batch insert all participants (single query instead of N queries)
    if (participantInputs.length > 0) {
      const participantValues = participantInputs.map(input => {
        const roll = rollD20();
        const initiative = roll + input.initiativeModifier;
        return {
          encounterId: encounter.id,
          characterId: input.characterId || null,
          npcId: input.npcId || null,
          name: input.name,
          initiative,
          initiativeModifier: input.initiativeModifier,
          turnOrder: 0, // Will be recalculated
          participantType: input.characterId ? 'player' as const : input.npcId ? 'npc' as const : 'other' as const,
        };
      });

      await db.insert(combatParticipants).values(participantValues);
    }

    // Calculate initial turn order
    await this.calculateTurnOrder(encounter.id);

    // Get the updated state
    return await this.getCombatState(encounter.id);
  }

  /**
   * Add a participant to an existing encounter
   */
  static async addParticipant(
    encounterId: string,
    input: CreateParticipantInput
  ): Promise<CombatParticipant> {
    // Roll initiative (d20 + modifier)
    const roll = rollD20();
    const initiative = roll + input.initiativeModifier;

    const [participant] = await db
      .insert(combatParticipants)
      .values({
        encounterId,
        characterId: input.characterId || null,
        npcId: input.npcId || null,
        name: input.name,
        initiative,
        initiativeModifier: input.initiativeModifier,
        turnOrder: 0, // Will be recalculated
        participantType: input.characterId ? 'player' : input.npcId ? 'npc' : 'other',
      })
      .returning();

    if (!participant) {
      throw new InternalServerError('Failed to add combat participant');
    }

    return participant;
  }

  /**
   * Roll or set initiative for a participant
   * @param encounterId - Combat encounter ID
   * @param participantId - Participant ID
   * @param roll - Optional dice roll (if not provided, will roll automatically)
   * @param modifier - Initiative modifier (DEX modifier)
   * @returns Initiative roll result
   */
  static async rollInitiative(
    encounterId: string,
    participantId: string,
    roll?: number,
    modifier?: number
  ): Promise<InitiativeRoll> {
    // Get participant
    const participant = await db.query.combatParticipants.findFirst({
      where: (cp, { eq, and }) => and(
        eq(cp.id, participantId),
        eq(cp.encounterId, encounterId)
      ),
    });

    if (!participant) {
      throw new NotFoundError('Participant', participantId);
    }

    // Use provided roll or roll d20
    const diceRoll = roll !== undefined ? roll : rollD20();
    const initiativeModifier = modifier !== undefined ? modifier : participant.initiativeModifier;
    const total = diceRoll + initiativeModifier;

    // Update participant initiative
    const [updated] = await db
      .update(combatParticipants)
      .set({
        initiative: total,
        initiativeModifier,
      })
      .where(and(
        eq(combatParticipants.id, participantId),
        eq(combatParticipants.encounterId, encounterId)
      ))
      .returning();

    if (!updated) {
      throw new InternalServerError('Failed to update initiative');
    }

    // Recalculate turn order
    await this.calculateTurnOrder(encounterId);

    return {
      participantId,
      roll: diceRoll,
      modifier: initiativeModifier,
      total,
    };
  }

  /**
   * Calculate and update turn order based on initiative
   * Sorts by initiative descending, ties broken by DEX modifier (higher first)
   * @param encounterId - Combat encounter ID
   */
  static async calculateTurnOrder(encounterId: string): Promise<void> {
    // Get all active participants
    const participants = await db.query.combatParticipants.findMany({
      where: (cp, { eq, and }) => and(
        eq(cp.encounterId, encounterId),
        eq(cp.isActive, true)
      ),
    });

    // Sort by initiative (desc), then by modifier (desc) for ties
    const sorted = participants.sort((a, b) => {
      if (b.initiative !== a.initiative) {
        return b.initiative - a.initiative;
      }
      return b.initiativeModifier - a.initiativeModifier;
    });

    // Skip if no participants to update
    if (sorted.length === 0) return;

    // Build batch update using SQL CASE statement (single query instead of N queries)
    const caseStatements = sorted.map((p, i) =>
      sql`WHEN ${p.id} THEN ${i}`
    );
    const participantIds = sorted.map(p => p.id);

    await db.execute(sql`
      UPDATE combat_participants
      SET turn_order = CASE id
        ${sql.join(caseStatements, sql` `)}
      END
      WHERE id IN ${participantIds}
    `);
  }

  /**
   * Advance to the next turn in combat
   * @param encounterId - Combat encounter ID
   * @returns Result with previous and current participants
   */
  static async advanceTurn(encounterId: string): Promise<AdvanceTurnResult> {
    // Single relational query to fetch encounter and active participants
    const encounterWithParticipants = await db.query.combatEncounters.findFirst({
      where: (ce, { eq }) => eq(ce.id, encounterId),
      with: {
        participants: {
          where: (cp, { eq }) => eq(cp.isActive, true),
          orderBy: (cp, { asc }) => [asc(cp.turnOrder)],
        },
      },
    });

    if (!encounterWithParticipants) {
      throw new NotFoundError('Combat encounter', encounterId);
    }

    const { participants, ...encounter } = encounterWithParticipants;

    if (encounter.status !== 'active') {
      throw new BusinessLogicError('Encounter is not active', { status: encounter.status });
    }

    if (participants.length === 0) {
      throw new BusinessLogicError('No active participants in combat');
    }

    // Get current participant (before advancing) from memory
    const previousParticipant = participants[encounter.currentTurnOrder] || null;

    // Calculate next turn
    const currentTurnOrder = encounter.currentTurnOrder;
    const nextTurnOrder = (currentTurnOrder + 1) % participants.length;
    const newRound = nextTurnOrder === 0 && currentTurnOrder !== 0;
    const newRoundNumber = newRound ? encounter.currentRound + 1 : encounter.currentRound;

    // Update encounter
    await db
      .update(combatEncounters)
      .set({
        currentTurnOrder: nextTurnOrder,
        currentRound: newRoundNumber,
        updatedAt: new Date(),
      })
      .where(and(
        eq(combatEncounters.id, encounterId),
        eq(combatEncounters.status, 'active')
      ));

    // Get new current participant from memory
    const currentParticipant = participants[nextTurnOrder];

    if (!currentParticipant) {
      throw new BusinessLogicError('No participant found at turn order position', { nextTurnOrder });
    }

    return {
      previousParticipant,
      currentParticipant,
      newRound,
      roundNumber: newRoundNumber,
    };
  }

  /**
   * Get the current active participant
   * @param encounterId - Combat encounter ID
   * @returns Current participant or null
   */
  static async getCurrentTurn(encounterId: string): Promise<CombatParticipant | null> {
    const encounterWithParticipants = await db.query.combatEncounters.findFirst({
      where: (ce, { eq }) => eq(ce.id, encounterId),
      with: {
        participants: {
          where: (cp, { eq }) => eq(cp.isActive, true),
          orderBy: (cp, { asc }) => [asc(cp.turnOrder)],
        },
      },
    });

    if (!encounterWithParticipants || encounterWithParticipants.participants.length === 0) {
      return null;
    }

    return encounterWithParticipants.participants[encounterWithParticipants.currentTurnOrder] || null;
  }

  /**
   * Manually reorder initiative for a participant
   * @param encounterId - Combat encounter ID
   * @param participantId - Participant ID
   * @param newInitiative - New initiative value
   */
  static async reorderInitiative(
    encounterId: string,
    participantId: string,
    newInitiative: number
  ): Promise<void> {
    // Update participant initiative
    await db
      .update(combatParticipants)
      .set({ initiative: newInitiative })
      .where(and(
        eq(combatParticipants.id, participantId),
        eq(combatParticipants.encounterId, encounterId)
      ));

    // Recalculate turn order
    await this.calculateTurnOrder(encounterId);
  }

  /**
   * End a combat encounter
   * @param encounterId - Combat encounter ID
   * @returns Updated encounter
   */
  static async endCombat(encounterId: string): Promise<CombatEncounter> {
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
      throw new InternalServerError('Failed to end combat encounter');
    }

    return updated;
  }

  /**
   * Get complete combat state
   * @param encounterId - Combat encounter ID
   * @returns Complete combat state with participants and turn order
   */
  static async getCombatState(encounterId: string): Promise<CombatState> {
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
    const turnOrder: TurnOrderEntry[] = activeParticipants.map((participant, index) => ({
      participant,
      isCurrent: currentParticipant?.id === participant.id,
      hasGone: index < encounter.currentTurnOrder,
    }));

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
  static async getEncounterById(encounterId: string): Promise<CombatEncounter | undefined> {
    return await db.query.combatEncounters.findFirst({
      where: (ce, { eq }) => eq(ce.id, encounterId),
    });
  }

  /**
   * Get active encounter for a session
   */
  static async getActiveEncounter(sessionId: string): Promise<CombatEncounter | undefined> {
    return await db.query.combatEncounters.findFirst({
      where: (ce, { eq, and }) => and(
        eq(ce.sessionId, sessionId),
        eq(ce.status, 'active')
      ),
    });
  }

  /**
   * Remove a participant from combat
   */
  static async removeParticipant(participantId: string): Promise<void> {
    const participant = await db.query.combatParticipants.findFirst({
      where: eq(combatParticipants.id, participantId),
      columns: { id: true, encounterId: true },
    });

    if (!participant) {
      return;
    }

    await db
      .update(combatParticipants)
      .set({ isActive: false })
      .where(and(
        eq(combatParticipants.id, participantId),
        eq(combatParticipants.encounterId, participant.encounterId)
      ));
  }

  /**
   * Update participant HP
   * Note: HP is now tracked in combatParticipantStatus table
   */
  static async updateParticipantHP(
    participantId: string,
    hpCurrent: number
  ): Promise<void> {
    // This method needs to be updated to use combatParticipantStatus table
    // For now, this is a placeholder to maintain API compatibility
    throw new Error('updateParticipantHP needs to be implemented with combatParticipantStatus table');
  }
}
