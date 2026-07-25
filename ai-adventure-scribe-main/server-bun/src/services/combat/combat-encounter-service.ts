/**
 * Combat Encounter Service
 *
 * Handles the lifecycle of combat encounters, including starting, ending,
 * and retrieving encounter state.
 *
 * Extracted from CombatInitiativeService.
 */

import { eq, and, or, sql, exists, inArray } from 'drizzle-orm';

import {
  verifyCharactersAccessBatch,
  verifyNPCsAccessBatch,
} from './combat-authorization.js';
import { InitiativeMechanics, rollD20 } from './initiative-mechanics.js';
import { GENERIC_NPC_STATS, resolveSrdMonsterStats } from './srd-monster-resolution.js';
import { db } from '../../../../db/client';
import {
  combatEncounters,
  combatParticipants,
  gameSessions,
  campaigns,
  characters,
  characterStats,
  npcs,
  combatParticipantStatus,
  type CombatEncounter,
  type CombatParticipant,
} from '../../../../db/schema/index';
import { NotFoundError, InternalServerError } from '../../lib/errors.js';

import type { EntitySize } from '../../tactical/types.js';
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
    userId?: string,
  ): Promise<CombatState> {
    if (userId) {
      const characterIds = [
        ...new Set(
          participantInputs
            .map((input) => input.characterId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      const npcIds = [
        ...new Set(
          participantInputs.map((input) => input.npcId).filter((id): id is string => Boolean(id)),
        ),
      ];

      // ⚡ Bolt: Parallelize independent authorization checks for participants to reduce database latency.
      // Session ownership is verified atomically in the subsequent INSERT ... SELECT query.
      await Promise.all([
        verifyCharactersAccessBatch(characterIds, userId),
        verifyNPCsAccessBatch(npcIds, userId),
      ]);
    }

    // 🛡️ Sentinel: Refactored to use atomic INSERT ... SELECT for session ownership verification.
    // This ensures combat encounters can only be started for authorized sessions in a single round-trip,
    // while masking resource existence and preventing race conditions.
    //
    // ⚠️ Every column of `combat_encounters` must be projected here, in table-definition
    // order. Drizzle's insert-select validates the projection against the table and throws
    // synchronously ("selected fields are not the same or are in a different order compared
    // to the table definition") otherwise — which is exactly how this endpoint 500'd on
    // every single call. Adding a column to the table means adding it here too.
    const [encounter] = await db
      .insert(combatEncounters)
      .select(
        db
          .select({
            id: sql`gen_random_uuid()`,
            sessionId: gameSessions.id,
            status: sql`${'active'}`,
            currentRound: sql`${surpriseRound ? 0 : 1}`,
            currentTurnOrder: sql`0`,
            version: sql`1`,
            location: sql`null::text`,
            difficulty: sql`null::text`,
            experienceAwarded: sql`null::integer`,
            startedAt: sql`now()`,
            endedAt: sql`null::timestamptz`,
            createdAt: sql`now()`,
            updatedAt: sql`now()`,
          })
          .from(gameSessions)
          .leftJoin(campaigns, eq(gameSessions.campaignId, campaigns.id))
          .leftJoin(characters, eq(gameSessions.characterId, characters.id))
          .where(
            and(
              eq(gameSessions.id, sessionId),
              userId
                ? or(
                    eq(campaigns.userId, userId),
                    eq(characters.userId, userId),
                    eq(characters.ownerId, userId),
                  )
                : sql`true`,
            ),
          )
          .limit(1),
      )
      .returning();

    if (!encounter) {
      // 🛡️ Sentinel: Throw NotFoundError for unauthorized access to mask resource existence.
      throw new NotFoundError('Session', sessionId);
    }

    let participants: CombatParticipant[] = [];
    const participantSizes: Record<string, EntitySize> = {};

    // Batch insert all participants (single query instead of N queries)
    if (participantInputs.length > 0) {
      const characterIds = participantInputs.flatMap((input) => input.characterId ? [input.characterId] : []);
      const npcIds = participantInputs.flatMap((input) => input.npcId ? [input.npcId] : []);
      const [characterRows, npcRows] = await Promise.all([
        characterIds.length ? db.select({ character: characters, stats: characterStats })
          .from(characters).leftJoin(characterStats, eq(characters.id, characterStats.characterId))
          .where(inArray(characters.id, characterIds)) : [],
        npcIds.length ? db.select().from(npcs).where(inArray(npcs.id, npcIds)) : [],
      ]);
      const charactersById = new Map(characterRows.map((row) => [row.character.id, row]));
      const npcsById = new Map(npcRows.map((row) => [row.id, row]));

      // ⚡ Bolt: Calculate initiative and turn order in-memory to avoid redundant DB round-trips.
      const participantsWithInitiative = participantInputs.map(input => {
        const character = input.characterId ? charactersById.get(input.characterId) : undefined;
        const npc = input.npcId ? npcsById.get(input.npcId) : undefined;
        const npcStats = (npc?.stats ?? {}) as Record<string, unknown>;
        // Structured DM combatants carry an SRD id instead of a database row. Resolving it
        // gives real stat blocks; a missing/unknown id falls back to generic NPC numbers,
        // and an unresolved *supplied* id is logged rather than silently swallowed.
        const monster =
          !input.characterId && !input.npcId
            ? resolveSrdMonsterStats(input.monsterId, input.name, { sessionId })
            : null;
        // Characters and NPCs keep their historical 10/10/30 defaults. Only a combatant with
        // no database row at all falls through to SRD or generic-NPC numbers.
        const fallback =
          input.characterId || input.npcId
            ? { armorClass: 10, maxHp: 10, speed: 30 }
            : (monster ?? GENERIC_NPC_STATS);
        const dexterity = Number(character?.stats?.dexterity ?? npcStats.dexterity ?? npcStats.dex ?? 10);
        const initiativeModifier = Number(
          character?.stats?.initiativeBonus ?? npcStats.initiativeModifier ??
            monster?.initiativeModifier ??
            // The client already computed the PC's DEX modifier; honour it rather than
            // silently zeroing initiative when no character_stats row exists.
            (Number.isFinite(input.initiativeModifier) ? input.initiativeModifier : undefined) ??
            Math.floor((dexterity - 10) / 2),
        );
        const armorClass = Number(
          character?.stats?.armorClass ?? npcStats.armorClass ?? npcStats.ac ?? fallback.armorClass,
        );
        const maxHp = Number(
          character?.stats?.maxHitPoints ?? npcStats.maxHp ?? npcStats.hitPoints ?? input.hpMax ??
            fallback.maxHp,
        );
        const currentHp = Number(character?.stats?.currentHitPoints ?? npcStats.currentHp ?? npcStats.hitPoints ?? input.hpCurrent ?? maxHp);
        const speed = Number(character?.stats?.speed ?? npcStats.speed ?? fallback.speed);
        const roll = rollD20();
        const initiative = InitiativeMechanics.calculateInitiative(roll, initiativeModifier);
        return {
          encounterId: encounter.id,
          characterId: input.characterId || null,
          npcId: input.npcId || null,
          name: input.name,
          initiative,
          initiativeModifier,
          armorClass,
          maxHp,
          speed,
          currentHp,
          damageResistances: monster?.damageResistances ?? [],
          damageImmunities: monster?.damageImmunities ?? [],
          damageVulnerabilities: monster?.damageVulnerabilities ?? [],
          participantType: input.characterId
            ? 'player' as const
            : input.npcId
              ? 'npc' as const
              // 'monster' (not 'other') is what the combat UI filters on for enemies.
              : input.monsterId
                ? 'monster' as const
                : 'other' as const,
          tacticalSize: monster?.size ?? GENERIC_NPC_STATS.size,
        };
      });

      // Sort by initiative (desc), then by modifier (desc) for ties to match calculateTurnOrder logic
      const sortedValues = InitiativeMechanics.sortParticipants(participantsWithInitiative);

      const participantValues = sortedValues.map(
        ({ currentHp: _currentHp, tacticalSize: _tacticalSize, ...p }, index) => ({
          ...p,
          turnOrder: index,
          isActive: true,
          resourcesRound: surpriseRound ? 0 : 1,
        }),
      );

      const insertedParticipants = await db.insert(combatParticipants).values(participantValues).returning();
      // combat_participants has no monster column, so the SRD size resolved above cannot be
      // re-derived from the row. Carry it out by participant id for tactical map generation.
      // Keyed on turnOrder rather than array position so it never depends on RETURNING order.
      const sizeByTurnOrder = new Map(
        sortedValues.map((participant, index) => [index, participant.tacticalSize]),
      );
      for (const inserted of insertedParticipants) {
        participantSizes[inserted.id] =
          sizeByTurnOrder.get(inserted.turnOrder) ?? GENERIC_NPC_STATS.size;
      }
      const currentHpByEntity = new Map(sortedValues.map((participant) => [
        participant.characterId ?? participant.npcId ?? participant.name,
        participant.currentHp,
      ]));
      await db.insert(combatParticipantStatus).values(insertedParticipants.map((participant) => ({
        participantId: participant.id,
        currentHp: currentHpByEntity.get(participant.characterId ?? participant.npcId ?? participant.name) ?? participant.maxHp,
        maxHp: participant.maxHp,
      })));
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
      participantSizes,
    };
  }

  /**
   * End a combat encounter
   * @param encounterId - Combat encounter ID
   * @returns Updated encounter
   */
  static async endCombat(encounterId: string, userId?: string): Promise<CombatEncounter> {
    // 🛡️ Sentinel: Refactored to perform ownership check atomically in the UPDATE query.
    // This ensures that combat encounters can only be ended by authorized users in a single round-trip.
    const [updated] = await db
      .update(combatEncounters)
      .set({
        status: 'completed',
        endedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(combatEncounters.id, encounterId),
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
            : sql`true`,
        ),
      )
      .returning();

    if (!updated) {
      // 🛡️ Sentinel: Throw NotFoundError for unauthorized access to mask resource existence.
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
    // 🛡️ Sentinel: Combined authorization and retrieval into a single relational query.
    // This ensures atomic verification and masks resource existence for unauthorized users.
    const encounterWithParticipants = await db.query.combatEncounters.findFirst({
      where: (ce, { eq, and, exists }) =>
        and(
          eq(ce.id, encounterId),
          userId
            ? exists(
                db
                  .select()
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
          orderBy: (cp, { asc }) => [asc(cp.turnOrder)],
          with: {
            status: true,
            conditions: { with: { condition: true } },
          },
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
  static async getEncounterById(
    encounterId: string,
    userId?: string,
  ): Promise<CombatEncounter | undefined> {
    // 🛡️ Sentinel: Refactored to incorporate ownership verification directly into the query
    // for both authenticated and internal/legacy paths to ensure consistent behavior and existence masking.
    const [result] = await db
      .select({ encounter: combatEncounters })
      .from(combatEncounters)
      .innerJoin(gameSessions, eq(combatEncounters.sessionId, gameSessions.id))
      .leftJoin(campaigns, eq(gameSessions.campaignId, campaigns.id))
      .leftJoin(characters, eq(gameSessions.characterId, characters.id))
      .where(
        and(
          eq(combatEncounters.id, encounterId),
          userId
            ? or(
                eq(campaigns.userId, userId),
                eq(characters.userId, userId),
                eq(characters.ownerId, userId),
              )
            : sql`true`,
        ),
      )
      .limit(1);

    return result?.encounter;
  }

  /**
   * Get active encounter for a session
   */
  static async getActiveEncounter(
    sessionId: string,
    userId?: string,
  ): Promise<CombatEncounter | undefined> {
    // 🛡️ Sentinel: Refactored to incorporate ownership verification directly into the query.
    const [result] = await db
      .select({ encounter: combatEncounters })
      .from(combatEncounters)
      .innerJoin(gameSessions, eq(combatEncounters.sessionId, gameSessions.id))
      .leftJoin(campaigns, eq(gameSessions.campaignId, campaigns.id))
      .leftJoin(characters, eq(gameSessions.characterId, characters.id))
      .where(
        and(
          eq(combatEncounters.sessionId, sessionId),
          eq(combatEncounters.status, 'active'),
          userId
            ? or(
                eq(campaigns.userId, userId),
                eq(characters.userId, userId),
                eq(characters.ownerId, userId),
              )
            : sql`true`,
        ),
      )
      .limit(1);

    return result?.encounter;
  }
}
