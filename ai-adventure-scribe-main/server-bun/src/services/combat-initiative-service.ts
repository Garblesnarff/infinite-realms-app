/* eslint-disable max-lines */
/**
 * Combat Initiative Service
 *
 * Type-safe combat initiative and turn order management for D&D 5E combat.
 * Handles encounter lifecycle, initiative rolls, and turn advancement.
 */

import { eq, and, sql, or, exists } from 'drizzle-orm';

import {
  verifyEncounterAccess,
  verifyCharacterAccess,
  verifyNPCAccess,
  verifyParticipantOwnership,
} from './combat/combat-authorization.js';
import { settleCheckConditionsForTurn } from './combat/combat-check-conditions.js';
import { InitiativeMechanics, rollD20 } from './combat/initiative-mechanics.js';
import { db } from '../../../db/client';
import {
  combatEncounters,
  combatParticipants,
  gameSessions,
  campaigns,
  characters,
  type CombatParticipant,
} from '../../../db/schema/index';
import { NotFoundError, BusinessLogicError } from '../lib/errors.js';
import { resetTurnResources } from './combat/combat-turn-resources.js';
import { resolveParticipantType } from './combat/participant-type.js';

import type { CreateParticipantInput, InitiativeRoll, AdvanceTurnResult } from '../types/combat.js';

/**
 * Combat Initiative Service
 * Provides type-safe database operations for combat encounters
 */
export class CombatInitiativeService {
  /**
   * Add a participant to an existing encounter
   */
  static async addParticipant(
    encounterId: string,
    input: CreateParticipantInput,
    userId?: string,
  ): Promise<CombatParticipant> {
    if (userId) {
      // ⚡ Bolt: Parallelize independent authorization checks to reduce database latency
      await Promise.all([
        verifyEncounterAccess(encounterId, userId),
        input.characterId ? verifyCharacterAccess(input.characterId, userId) : Promise.resolve(),
        input.npcId ? verifyNPCAccess(input.npcId, userId) : Promise.resolve(),
      ]);
    }

    // Roll initiative (d20 + modifier)
    const roll = rollD20();
    const initiative = InitiativeMechanics.calculateInitiative(roll, input.initiativeModifier);
    const participantType = resolveParticipantType(input);

    // This insert-select projected 8 of combat_participants' 25 columns, so Drizzle
    // threw before issuing it and no participant could ever be added to an encounter.
    // Its ownership clause was also redundant: verifyEncounterAccess above runs the
    // identical query whenever userId is set. All that remains for the userId-less
    // path is proving the encounter exists at all.
    const [encounter] = await db
      .select({ id: combatEncounters.id })
      .from(combatEncounters)
      .where(eq(combatEncounters.id, encounterId))
      .limit(1);

    if (!encounter) {
      // 🛡️ Sentinel: Throw NotFoundError for unauthorized access to mask resource existence.
      throw new NotFoundError('Combat encounter', encounterId);
    }

    const [participant] = await db
      .insert(combatParticipants)
      .values({
        encounterId,
        characterId: input.characterId || null,
        npcId: input.npcId || null,
        name: input.name,
        initiative,
        initiativeModifier: input.initiativeModifier,
        turnOrder: 0,
        participantType,
      })
      .returning();

    if (!participant) {
      throw new NotFoundError('Combat encounter', encounterId);
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
    modifier?: number,
    userId?: string,
  ): Promise<InitiativeRoll> {
    // ⚡ Bolt: Parallelize ownership verification and participant retrieval to reduce latency
    const [_, participant] = await Promise.all([
      userId ? verifyParticipantOwnership(participantId, encounterId, userId) : Promise.resolve(),
      db.query.combatParticipants.findFirst({
        where: (cp, { eq, and }) => and(eq(cp.id, participantId), eq(cp.encounterId, encounterId)),
      }),
    ]);

    if (!participant) {
      throw new NotFoundError('Participant', participantId);
    }

    // Initiative is authoritative: caller-provided values are legacy display hints only.
    const diceRoll = rollD20();
    const initiativeModifier = participant.initiativeModifier;
    const total = InitiativeMechanics.calculateInitiative(diceRoll, initiativeModifier);

    // Update participant initiative
    // 🛡️ Sentinel: Refactored to perform ownership check atomically in the UPDATE query.
    const [updated] = await db
      .update(combatParticipants)
      .set({
        initiative: total,
        initiativeModifier,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(combatParticipants.id, participantId),
          eq(combatParticipants.encounterId, encounterId),
          userId
            ? exists(
                db
                  .select({ one: sql`1` })
                  .from(combatEncounters)
                  .innerJoin(gameSessions, eq(combatEncounters.sessionId, gameSessions.id))
                  .leftJoin(campaigns, eq(gameSessions.campaignId, campaigns.id))
                  .leftJoin(characters, eq(combatParticipants.characterId, characters.id))
                  .where(
                    and(
                      eq(combatEncounters.id, combatParticipants.encounterId),
                      or(
                        eq(campaigns.userId, userId),
                        eq(characters.userId, userId),
                        eq(characters.ownerId, userId),
                      ),
                    ),
                  ),
              )
            : sql`true`,
        ),
      )
      .returning();

    if (!updated) {
      // 🛡️ Sentinel: Throw NotFoundError for unauthorized access to mask resource existence.
      throw new NotFoundError('Participant', participantId);
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
    // ⚡ Bolt: Optimized to use a single atomic SQL UPDATE with a window function (ROW_NUMBER()).
    // This reduces database round-trips from 2 to 1 and avoids loading all participants into memory.
    await db.execute(sql`
      WITH sorted_participants AS (
        SELECT id, (ROW_NUMBER() OVER (ORDER BY initiative DESC, initiative_modifier DESC) - 1) as new_turn_order
        FROM combat_participants
        WHERE encounter_id = ${encounterId} AND is_active = true
      )
      UPDATE combat_participants
      SET turn_order = sorted_participants.new_turn_order
      FROM sorted_participants
      WHERE combat_participants.id = sorted_participants.id
    `);
  }

  /**
   * Advance to the next turn in combat
   * @param encounterId - Combat encounter ID
   * @param from - The turn the caller acted on. When given, the turn moves only off that turn:
   *   a second request that acted on the same turn is refused instead of advancing it again.
   * @returns Result with previous and current participants
   */
  static async advanceTurn(
    encounterId: string,
    userId?: string,
    from?: { round: number; turnOrder: number },
  ): Promise<AdvanceTurnResult> {
    // 🛡️ Sentinel: Combined authorization and retrieval into a single relational query.
    // This ensures atomic verification and masks resource existence for unauthorized users.
    const encounterWithParticipants = await db.query.combatEncounters.findFirst({
      where: (ce, { eq, and, or, exists, sql }) =>
        and(
          eq(ce.id, encounterId),
          userId
            ? exists(
                db
                  .select({ one: sql`1` })
                  .from(gameSessions)
                  .leftJoin(campaigns, eq(gameSessions.campaignId, campaigns.id))
                  .leftJoin(characters, eq(gameSessions.characterId, characters.id))
                  .where(
                    and(
                      eq(gameSessions.id, ce.sessionId),
                      or(
                        eq(campaigns.userId, userId),
                        eq(characters.userId, userId),
                        eq(characters.ownerId, userId),
                      ),
                    ),
                  ),
              )
            : sql`true`,
        ),
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
    const { nextTurnOrder, newRound, newRoundNumber } = InitiativeMechanics.calculateNextTurn(
      encounter.currentTurnOrder,
      participants.length,
      encounter.currentRound,
    );

    // Update encounter
    const update = db
      .update(combatEncounters)
      .set({
        currentTurnOrder: nextTurnOrder,
        currentRound: newRoundNumber,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(combatEncounters.id, encounterId),
          eq(combatEncounters.status, 'active'),
          from
            ? and(
                eq(combatEncounters.currentRound, from.round),
                eq(combatEncounters.currentTurnOrder, from.turnOrder),
              )
            : sql`true`,
        ),
      );
    if (!from) await update;
    else if ((await update.returning({ id: combatEncounters.id })).length === 0) {
      throw new BusinessLogicError('The turn has already moved on', {
        reason: 'turn_conflict',
        expected: from,
      });
    }

    // Get new current participant from memory
    const currentParticipant = participants[nextTurnOrder];

    if (!currentParticipant) {
      throw new BusinessLogicError('No participant found at turn order position', {
        nextTurnOrder,
      });
    }

    await resetTurnResources(currentParticipant.id, newRoundNumber);
    await settleCheckConditionsForTurn({
      encounterId,
      sessionId: encounter.sessionId,
      startingParticipantId: currentParticipant.id,
      roundNumber: newRoundNumber,
      newRound,
    });

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
  static async getCurrentTurn(
    encounterId: string,
    userId?: string,
  ): Promise<CombatParticipant | null> {
    // ⚡ Bolt: Consolidated ownership verification and participant retrieval into a single joined query.
    // By joining participants directly on turnOrder = currentTurnOrder, we reduce database round-trips
    // from ~2 to 1 and avoid loading the entire participant list into memory.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [result] = await (db as any)
      .select({
        participant: combatParticipants,
      })
      .from(combatParticipants)
      .innerJoin(
        combatEncounters,
        and(
          eq(combatParticipants.encounterId, combatEncounters.id),
          eq(combatParticipants.turnOrder, combatEncounters.currentTurnOrder),
        ),
      )
      .where(
        and(
          eq(combatEncounters.id, encounterId),
          eq(combatParticipants.isActive, true),
          userId
            ? exists(
                db
                  .select()
                  .from(gameSessions)
                  .leftJoin(campaigns, eq(gameSessions.campaignId, campaigns.id))
                  .leftJoin(characters, eq(gameSessions.characterId, characters.id))
                  .where(
                    and(
                      eq(gameSessions.id, combatEncounters.sessionId),
                      or(
                        eq(campaigns.userId, userId),
                        eq(characters.userId, userId),
                        eq(characters.ownerId, userId),
                      ),
                    ),
                  ),
              )
            : undefined,
        ),
      )
      .limit(1);

    if (!result && userId) {
      // ⚡ Bolt: If no result found, verify access to maintain standard error behavior (masking)
      // while keeping the happy path O(1).
      await verifyEncounterAccess(encounterId, userId);
    }

    return result?.participant || null;
  }

  /**
   * Remove a participant from combat
   */
  static async removeParticipant(participantId: string, userId?: string): Promise<void> {
    // 🛡️ Sentinel: Refactored to use a single atomic UPDATE statement with inline ownership verification.
    // This eliminates pre-flight queries and prevents IDOR while masking resource existence.
    await db
      .update(combatParticipants)
      .set({ isActive: false, updatedAt: new Date() })
      .where(
        and(
          eq(combatParticipants.id, participantId),
          userId
            ? exists(
                db
                  .select({ one: sql`1` })
                  .from(combatEncounters)
                  .innerJoin(gameSessions, eq(combatEncounters.sessionId, gameSessions.id))
                  .leftJoin(campaigns, eq(gameSessions.campaignId, campaigns.id))
                  .leftJoin(characters, eq(combatParticipants.characterId, characters.id))
                  .where(
                    and(
                      eq(combatEncounters.id, combatParticipants.encounterId),
                      or(
                        eq(campaigns.userId, userId),
                        eq(characters.userId, userId),
                        eq(characters.ownerId, userId),
                      ),
                    ),
                  ),
              )
            : sql`true`,
        ),
      );
  }

  /**
   * Update participant HP
   * Note: HP is now tracked in combatParticipantStatus table
   */
  static async updateParticipantHP(_participantId: string, _hpCurrent: number): Promise<void> {
    // This method needs to be updated to use combatParticipantStatus table
    // For now, this is a placeholder to maintain API compatibility
    throw new Error(
      'updateParticipantHP needs to be implemented with combatParticipantStatus table',
    );
  }
}
