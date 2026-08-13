/**
 * Combat Encounter Service
 *
 * Handles the lifecycle of combat encounters, including starting, ending,
 * and retrieving encounter state.
 *
 * Extracted from CombatInitiativeService.
 */

import { eq, and, or, sql, exists, inArray } from 'drizzle-orm';

import { loadCampaignMonsterIndex } from './campaign-monster-resolution.js';
import { verifyCharactersAccessBatch, verifyNPCsAccessBatch } from './combat-authorization.js';
import { resolveCombatantStats } from './combatant-stat-resolution.js';
import { InitiativeMechanics, rollD20 } from './initiative-mechanics.js';
import { scaleMonsterForParty } from './party-scaling.js';
import { GENERIC_NPC_STATS } from './srd-monster-resolution.js';
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
import { NotFoundError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

import type { EntitySize } from '../../tactical/types.js';
import type {
  CombatEndReason,
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

    // Session-ownership check split out of the insert.
    //
    // This call site was repaired in 33537a67 by extending the projection to all 13
    // columns of combat_encounters -- correct, but load-bearing on a comment: adding
    // a column to the table silently re-broke it, and the failure only ever showed up
    // as a 500 in production. The check is separable, so it is now separate, and the
    // insert-select ban in eslint.config.js stops the pattern coming back.
    const [session] = await db
      .select({ id: gameSessions.id, starterCampaignId: gameSessions.starterCampaignId })
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
      .limit(1);

    if (!session) {
      // 🛡️ Sentinel: Throw NotFoundError for unauthorized access to mask resource existence.
      throw new NotFoundError('Session', sessionId);
    }

    const [encounter] = await db
      .insert(combatEncounters)
      .values({
        sessionId: session.id,
        status: 'active',
        currentRound: surpriseRound ? 0 : 1,
        currentTurnOrder: 0,
        version: 1,
        location: null,
        difficulty: null,
        experienceAwarded: null,
      })
      .returning();

    if (!encounter) {
      throw new NotFoundError('Session', sessionId);
    }

    let participants: CombatParticipant[] = [];
    const participantSizes: Record<string, EntitySize> = {};

    // Batch insert all participants (single query instead of N queries)
    if (participantInputs.length > 0) {
      const characterIds = participantInputs.flatMap((input) =>
        input.characterId ? [input.characterId] : [],
      );
      const npcIds = participantInputs.flatMap((input) => (input.npcId ? [input.npcId] : []));
      const [characterRows, npcRows] = await Promise.all([
        characterIds.length
          ? db
              .select({ character: characters, stats: characterStats })
              .from(characters)
              .leftJoin(characterStats, eq(characters.id, characterStats.characterId))
              .where(inArray(characters.id, characterIds))
          : [],
        npcIds.length ? db.select().from(npcs).where(inArray(npcs.id, npcIds)) : [],
      ]);
      const charactersById = new Map(characterRows.map((row) => [row.character.id, row]));
      const npcsById = new Map(npcRows.map((row) => [row.id, row]));

      // One indexed, memoized query per campaign for the whole encounter -- never one per
      // combatant. A campaign with no starter bible yields an empty index and the ladder
      // starts at the SRD rung, exactly as it did before authored stats existed.
      const campaignIndex = await loadCampaignMonsterIndex(session.starterCampaignId);

      /**
       * The party the stat blocks are about to be fitted to.
       *
       * Counted from the encounter's own player-type participants — the same derivation
       * `participantType` uses below — rather than assumed to be one. Every combatant is
       * living at the moment combat starts, so "living player-type participants" is exactly
       * this count today; when AI party members ship they arrive as further `characterId`
       * inputs and this reads 2, 3 or 4 with no change here.
       */
      const partySize = Math.max(
        1,
        participantInputs.filter((input) => Boolean(input.characterId)).length,
      );

      // ⚡ Bolt: Calculate initiative and turn order in-memory to avoid redundant DB round-trips.
      const participantsWithInitiative = participantInputs.map((input) => {
        const character = input.characterId ? charactersById.get(input.characterId) : undefined;
        const npc = input.npcId ? npcsById.get(input.npcId) : undefined;
        const npcStats = (npc?.stats ?? {}) as Record<string, unknown>;
        // Structured DM combatants carry an id instead of a database row. Resolving it walks
        // the ladder -- campaign-authored bible stats, then the SRD catalog, then generic NPC
        // numbers -- and every rung down is logged rather than silently swallowed.
        const monster =
          !input.characterId && !input.npcId
            ? resolveCombatantStats(campaignIndex, input.monsterId, input.name, { sessionId })
            : null;
        // Characters and NPCs keep their historical 10/10/30 defaults. Only a combatant with
        // no database row at all falls through to SRD or generic-NPC numbers.
        const fallback =
          input.characterId || input.npcId
            ? { armorClass: 10, maxHp: 10, speed: 30 }
            : (monster ?? GENERIC_NPC_STATS);
        const dexterity = Number(
          character?.stats?.dexterity ?? npcStats.dexterity ?? npcStats.dex ?? 10,
        );
        const initiativeModifier = Number(
          character?.stats?.initiativeBonus ??
            npcStats.initiativeModifier ??
            monster?.initiativeModifier ??
            // The client already computed the PC's DEX modifier; honour it rather than
            // silently zeroing initiative when no character_stats row exists.
            (Number.isFinite(input.initiativeModifier) ? input.initiativeModifier : undefined) ??
            Math.floor((dexterity - 10) / 2),
        );
        const armorClass = Number(
          character?.stats?.armorClass ?? npcStats.armorClass ?? npcStats.ac ?? fallback.armorClass,
        );
        const rawMaxHp = Number(
          character?.stats?.maxHitPoints ??
            npcStats.maxHp ??
            npcStats.hitPoints ??
            input.hpMax ??
            fallback.maxHp,
        );
        const rawCurrentHp = Number(
          character?.stats?.currentHitPoints ??
            npcStats.currentHp ??
            npcStats.hitPoints ??
            input.hpCurrent ??
            rawMaxHp,
        );

        /**
         * Party scaling applies to exactly the combatants the stat ladder resolves: those with
         * neither a character row nor an NPC row. Those are the ones whose numbers came from a
         * source priced for four adventurers — a campaign bible, the SRD catalog, the CR table,
         * or a DM-supplied `hpMax` written with the same party-sized instinct.
         *
         * Player characters and database NPCs are untouched. A PC's hit points are the
         * player's own, and an NPC row is a specific creature somebody authored for this
         * world rather than an encounter-budget number.
         *
         * The generic rung is untouched too, and for the same reason read the other way
         * round: `GENERIC_NPC_STATS.maxHp` is a placeholder for a combatant nobody wrote at
         * all — a Doorkeeper, a Hostile Patron — not a number priced against four
         * adventurers. Scaling it would take an improvised bystander to 3 hit points on the
         * strength of an assumption its author never made. So the requirement is a resolved
         * stat block OR hit points the DM stated outright, both of which are party-sized;
         * neither is the fallback default.
         */
        const scalable =
          !input.characterId && !input.npcId && (monster !== null || input.hpMax != null);
        const scaled = scalable
          ? scaleMonsterForParty({
              rawMaxHp,
              rawCurrentHp,
              attackProfile: monster?.attackProfile ?? null,
              partySize,
            })
          : null;
        const maxHp = scaled ? scaled.maxHp : rawMaxHp;
        const currentHp = scaled ? scaled.currentHp : rawCurrentHp;
        const attackProfile = scaled?.attackProfile ?? monster?.attackProfile ?? null;

        if (monster) {
          // One line per combatant naming the attack it will actually swing and the rung that
          // supplied it. `derived` is the one that matters: it says the engine INFERRED these
          // numbers from the creature's hit points because nobody wrote an attack down, which
          // is a materially weaker claim than reading a printed stat block. A log that called
          // all three "resolved" would make an inference indistinguishable from a fact.
          //
          // The attack reported is the SCALED one, because that is the attack the creature
          // will actually make. The raw expression it was fitted from travels beside it under
          // `partyScaling`, so the adjustment can be undone by a reader rather than guessed at.
          const profile = attackProfile ?? monster.attackProfile;
          const primary = profile.attacks[0];
          logger.info({
            msg: 'COMBAT_MONSTER_ATTACK_PROFILE',
            sessionId,
            combatantName: input.name,
            monsterId: input.monsterId ?? null,
            resolvedAs: monster.monsterName,
            statSource: monster.source,
            attackSource: profile.source,
            attackCount: profile.attacks.length,
            attack: primary
              ? `${primary.name} +${primary.attackBonus}, ${primary.damageDice}${
                  primary.damageBonus ? `+${primary.damageBonus}` : ''
                } ${primary.damageType}`
              : null,
            ...(profile.derivation ? { derivation: profile.derivation } : {}),
            ...(profile.multiattack ? { multiattackNotExpressed: profile.multiattack.desc } : {}),
            ...(profile.unsupported?.length ? { unsupportedActions: profile.unsupported } : {}),
          });
        }
        if (scaled && scaled.factor < 1) {
          // Logged separately from the profile line and only when it changes something. A
          // scaler that rewrites a stat block in silence is the same class of problem as the
          // silent stat fallbacks this project spent weeks eliminating.
          logger.info({
            msg: 'COMBAT_PARTY_SCALING',
            sessionId,
            combatantName: input.name,
            monsterId: input.monsterId ?? null,
            partySize: scaled.partySize,
            baseline: scaled.scaling.baseline,
            factor: scaled.factor,
            hp: `${scaled.scaling.rawMaxHp} -> ${scaled.maxHp}`,
            damage: scaled.scaling.rawAttacks.map(
              (raw, index) =>
                `${raw} -> ${scaled.attackProfile?.attacks[index]?.damageDice ?? '?'}${
                  scaled.attackProfile?.attacks[index]?.damageBonus
                    ? `+${scaled.attackProfile.attacks[index].damageBonus}`
                    : ''
                }`,
            ),
          });
        }
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
            ? ('player' as const)
            : input.npcId
              ? ('npc' as const)
              : // 'monster' (not 'other') is what the combat UI filters on for enemies.
                input.monsterId
                ? ('monster' as const)
                : ('other' as const),
          // Stored, not re-derived at attack time. A participant carries no monster id, so
          // an attack-time lookup would have to work from the display name -- and combat
          // numbers duplicates ("Shadow Roach 2"), which normalizes to a key no catalog
          // holds. Resolving once here, where the campaign index and the catalog are both
          // in hand, is also what lets the row record WHICH rung supplied the numbers.
          monsterAttack: attackProfile,
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

      const insertedParticipants = await db
        .insert(combatParticipants)
        .values(participantValues)
        .returning();
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
      const currentHpByEntity = new Map(
        sortedValues.map((participant) => [
          participant.characterId ?? participant.npcId ?? participant.name,
          participant.currentHp,
        ]),
      );
      await db.insert(combatParticipantStatus).values(
        insertedParticipants.map((participant) => ({
          participantId: participant.id,
          currentHp:
            currentHpByEntity.get(
              participant.characterId ?? participant.npcId ?? participant.name,
            ) ?? participant.maxHp,
          maxHp: participant.maxHp,
        })),
      );
      // Ensure participants are sorted by turnOrder to match getCombatState behavior
      participants = insertedParticipants.sort((a, b) => a.turnOrder - b.turnOrder);
    }

    // ⚡ Bolt: Construct CombatState in-memory to avoid redundant fetch of just-inserted data.
    // This reduces database round-trips from 6 down to 3.
    const activeParticipants = participants.filter((p) => p.isActive);
    const currentParticipant = activeParticipants[0] || null;

    const turnOrder: TurnOrderEntry[] = InitiativeMechanics.getTurnOrderEntries(
      activeParticipants,
      0,
      currentParticipant?.id || null,
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
   * End a combat encounter.
   *
   * `reason` is required, and it is required *by the type* rather than defaulted, because the
   * only way an encounter reached a terminal state with nothing to say for itself was that the
   * three callers outside `endCombatIfResolved` were not asked. Every caller now names which
   * ending this is, and the same statement that writes `completed` writes the reason.
   *
   * @param encounterId - Combat encounter ID
   * @param reason - Which ending this is; stored on the row and reported in telemetry
   * @returns Updated encounter, or null when the encounter was already terminal
   */
  static async endCombat(
    encounterId: string,
    userId: string | undefined,
    reason: CombatEndReason,
  ): Promise<CombatEncounter | null> {
    // 🛡️ Sentinel: Refactored to perform ownership check atomically in the UPDATE query.
    // This ensures that combat encounters can only be ended by authorized users in a single round-trip.
    // The active-status predicate is also the idempotency claim: exactly one caller can own the
    // terminal transition, so the ending facts and broadcasts cannot be duplicated by a retry.
    const [updated] = await db
      .update(combatEncounters)
      .set({
        status: 'completed',
        endedReason: reason,
        endedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(combatEncounters.id, encounterId),
          eq(combatEncounters.status, 'active'),
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
      // Distinguish an authorized retry of an already-completed encounter from an unknown or
      // unauthorized one without exposing either resource. A concurrent winner also lands here
      // after the active-status claim has changed the row.
      const existing = await this.getEncounterById(encounterId, userId);
      if (!existing) {
        // 🛡️ Sentinel: Throw NotFoundError for unauthorized access to mask resource existence.
        throw new NotFoundError('Combat encounter', encounterId);
      }
      if (existing.status !== 'active') return null;
      // The guarded update should only miss an active row if a concurrent transition won between
      // the two statements. Treat that the same as an already-completed retry.
      return null;
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
    const activeParticipants = participants.filter((p) => p.isActive);
    const currentParticipant = activeParticipants[encounter.currentTurnOrder] || null;

    // Build turn order entries in-memory
    const turnOrder: TurnOrderEntry[] = InitiativeMechanics.getTurnOrderEntries(
      activeParticipants,
      encounter.currentTurnOrder,
      currentParticipant?.id || null,
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
