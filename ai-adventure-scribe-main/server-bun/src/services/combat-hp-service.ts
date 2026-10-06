/* eslint-disable max-lines, @typescript-eslint/no-explicit-any */
/**
 * Combat HP Service
 *
 * Handles HP tracking, damage application, healing, temp HP, and death saves
 * for D&D 5E combat encounters. Implements all D&D 5E rules for damage resistance,
 * vulnerability, temporary hit points, and death saving throws.
 *
 * `combat_participant_status` is a write-through cache of the character record, not an
 * independent owner of a player's hit points. Every write path below that touches a
 * participant with a `character_id` writes `character_stats` first, in the same transaction,
 * and then mirrors the result onto the participant row. Before that, a fight's damage lived
 * and died with the encounter: participants were seeded from the sheet at `startCombat` and
 * `concludeEncounter` never synced anything back, so a character could be beaten to 1 HP,
 * win, and walk away at full health (#1826). Write-through removes the drift window entirely,
 * which is why there is no sync step at the end of a fight to get wrong.
 *
 * @module server/services/combat-hp-service
 */

import { and, eq, exists, or, sql } from 'drizzle-orm';

import { CharacterVitalsService } from './character-vitals-service.js';
import { db } from '../../../db/client';
import {
  combatParticipantStatus,
  combatDamageLog,
  combatParticipants,
  combatEncounters,
  gameSessions,
  campaigns,
  characters,
} from '../../../db/schema/index';
import { ValidationError, BusinessLogicError, NotFoundError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import {
  getParticipantWithFullContext,
  getParticipantStatusScoped,
  getDamageLog,
  getParticipantStatus,
  initializeParticipantStatus,
} from './combat/hp-data-access.js';
import { HPMechanics } from './combat/hp-mechanics.js';

import type { CombatResolvedVitals } from './character-vitals-service.js';
import type { CombatParticipantStatus, CombatDamageLog } from '../../../db/schema/index';
import type {
  DamageResult,
  HealingResult,
  DeathSaveResult,
  StabilizationResult,
  ApplyDamageOptions,
} from '../types/combat.js';

/**
 * The columns one combat write touches on `combat_participant_status`.
 *
 * Partial on purpose: each path writes exactly the columns it wrote before write-through
 * existed. Filling in the rest with their current values would read the same in the table and
 * quite different in a diff.
 */
interface ParticipantStatusPatch {
  currentHp?: number;
  tempHp?: number;
  isConscious?: boolean;
  deathSavesSuccesses?: number;
  deathSavesFailures?: number;
}

/** Either the connection pool or an open transaction. Both run the participant UPDATE. */
type StatusWriter = Pick<typeof db, 'update'>;

/** One combat outcome, in both the shapes it has to be stored in. */
interface WriteThroughRequest {
  participantId: string;
  encounterId: string;
  /** Null for NPCs and monsters, which have no character record to be the source of truth. */
  characterId: string | null;
  userId?: string;
  status: ParticipantStatusPatch;
  character: CombatResolvedVitals;
  /**
   * Compare-and-set guard: the write lands only while the row still holds these tallies at 0 HP
   * and unconscious. A death save is one roll per turn, so two saves racing on the same tallies
   * must resolve to one accepted write and one conflict (#2518).
   */
  expectedDying?: { successes: number; failures: number };
  /**
   * Spend the participant's Action in the same transaction as the write. A death save is the
   * dying player's whole turn, and this is the per-turn marker: a retry of a save that was
   * already recorded finds the Action spent and rolls nothing (#2518).
   */
  spendAction?: boolean;
}

/**
 * Marks the encounter as having just had activity (`combat_encounters.updated_at`, which the
 * idle-encounter sweeper reads). Best-effort, for the same reason the damage log is: it runs on
 * the pool after the HP write has committed, so letting it throw would fail an attack whose
 * damage already landed -- skipping the damage-log insert and inviting a retry that applies the
 * damage a second time. A missed bump costs the sweeper a stale timestamp, nothing more.
 */
async function touchEncounterActivity(encounterId: string): Promise<void> {
  try {
    await db
      .update(combatEncounters)
      .set({ updatedAt: new Date() })
      .where(eq(combatEncounters.id, encounterId));
  } catch (error) {
    logger.warn({ msg: 'COMBAT_ENCOUNTER_TOUCH_FAILED', error, encounterId });
  }
}

/**
 * Combat HP Service
 */
export class CombatHPService {
  /**
   * Helper to build a subquery filter that verifies a user owns the encounter
   * associated with a participant.
   * 🛡️ Sentinel: Centralized ownership verification to prevent IDOR and existence leakage.
   */
  private static getEncounterOwnershipFilter(
    participantId: string,
    encounterId: string,
    userId: string,
  ): any {
    return exists(
      db
        .select()
        .from(combatParticipants)
        .innerJoin(combatEncounters, eq(combatParticipants.encounterId, combatEncounters.id))
        .innerJoin(gameSessions, eq(combatEncounters.sessionId, gameSessions.id))
        .leftJoin(campaigns, eq(gameSessions.campaignId, campaigns.id))
        .leftJoin(characters, eq(gameSessions.characterId, characters.id))
        .where(
          and(
            eq(combatParticipants.id, participantId),
            eq(combatParticipants.encounterId, encounterId),
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
   * The participant-status write, exactly as it has always been: one atomic UPDATE carrying
   * the ownership filter, and a NotFoundError when it matches nothing.
   *
   * Takes its writer rather than reaching for `db` so the write-through path can hand it the
   * open transaction. When it throws inside one, the character write that preceded it goes
   * with it.
   */
  private static async updateParticipantStatus(
    writer: StatusWriter,
    participantId: string,
    encounterId: string,
    patch: ParticipantStatusPatch,
    userId?: string,
    expectedDying?: { successes: number; failures: number },
  ): Promise<void> {
    const updated = await writer
      .update(combatParticipantStatus)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(
          eq(combatParticipantStatus.participantId, participantId),
          userId ? this.getEncounterOwnershipFilter(participantId, encounterId, userId) : sql`true`,
          expectedDying
            ? and(
                eq(combatParticipantStatus.currentHp, 0),
                eq(combatParticipantStatus.isConscious, false),
                eq(combatParticipantStatus.deathSavesSuccesses, expectedDying.successes),
                eq(combatParticipantStatus.deathSavesFailures, expectedDying.failures),
              )
            : sql`true`,
        ),
      )
      .returning();

    if (expectedDying && (!updated || updated.length === 0)) {
      // Not NotFound: the participant exists, another save got there first.
      throw new BusinessLogicError('A death saving throw was already recorded for this turn', {
        participantId,
        reason: 'death_save_conflict',
      });
    }
    if (userId && (!updated || updated.length === 0)) {
      throw new NotFoundError('Participant', participantId);
    }
  }

  /**
   * Persist one combat outcome: the character record first as the source of truth, the
   * participant row second as its mirror, both in a single transaction.
   *
   * A participant with no `character_id` — every NPC and monster — takes the untransacted
   * single-statement path it always took. There is no second row to keep in step, and a
   * goblin's hit points have never outlived the encounter.
   */
  private static async writeThrough(request: WriteThroughRequest): Promise<void> {
    const {
      participantId,
      encounterId,
      characterId,
      userId,
      status,
      character,
      expectedDying,
      spendAction,
    } = request;

    const spend = async (writer: StatusWriter): Promise<void> => {
      if (!spendAction) return;
      const spent = await writer
        .update(combatParticipants)
        .set({ actionUsed: true, updatedAt: new Date() })
        .where(
          and(eq(combatParticipants.id, participantId), eq(combatParticipants.actionUsed, false)),
        )
        .returning({ id: combatParticipants.id });
      if (spent.length === 0) {
        throw new BusinessLogicError('A death saving throw was already recorded for this turn', {
          participantId,
          reason: 'death_save_conflict',
        });
      }
    };

    if (!characterId) {
      if (!spendAction) {
        await this.updateParticipantStatus(
          db,
          participantId,
          encounterId,
          status,
          userId,
          expectedDying,
        );
        return;
      }
      await db.transaction(async (tx) => {
        await this.updateParticipantStatus(
          tx,
          participantId,
          encounterId,
          status,
          userId,
          expectedDying,
        );
        await spend(tx);
      });
      return;
    }

    await db.transaction(async (tx) => {
      const mirrored = await CharacterVitalsService.mirrorFromCombat(tx, characterId, character);
      if (!mirrored) {
        // The participant points at a character with no stats row. The fight continues on the
        // participant row alone -- the pre-write-through behaviour -- but it is said out loud,
        // because from here on a divergent character sheet has exactly one explanation.
        logger.warn({
          msg: 'COMBAT_HP_MIRROR_SKIPPED',
          reason: 'no character_stats row',
          encounterId,
          participantId,
          characterId,
        });
      }

      await this.updateParticipantStatus(
        tx,
        participantId,
        encounterId,
        status,
        userId,
        expectedDying,
      );
      await spend(tx);
    });
  }

  /**
   * Apply damage to a participant with D&D 5E rules.
   * ⚡ Bolt: Supports optional pre-fetched participant data (including status and encounter)
   * to eliminate redundant database SELECT queries during batch processing (e.g. AoE spells).
   */
  static async applyDamage(
    participantId: string,
    encounterId: string,
    options: ApplyDamageOptions,
    userId?: string,
    preFetchedParticipant?: any,
  ): Promise<DamageResult> {
    const { damageAmount, damageType, sourceParticipantId, sourceDescription } = options;

    // ⚡ Bolt: Consolidated authorization and data retrieval into a single query if not pre-fetched.
    const { participant, status, currentRound } = preFetchedParticipant
      ? {
          participant: preFetchedParticipant,
          status: preFetchedParticipant.status,
          currentRound: preFetchedParticipant.encounter?.currentRound || 1,
        }
      : await getParticipantWithFullContext(participantId, encounterId, userId);

    if (!status) {
      throw new BusinessLogicError('Participant has no status record', { participantId });
    }

    // Delegate pure logic to HPMechanics.
    //
    // `targetIsPlayer` is read off the participant row here rather than taken from the caller.
    // The per-hit cap is a safety property, and a safety property that every call site has to
    // remember to opt into is one that a future call site will forget.
    const result = HPMechanics.calculateDamageResult(
      participantId,
      status,
      {
        damageImmunities: participant.damageImmunities,
        damageResistances: participant.damageResistances,
        damageVulnerabilities: participant.damageVulnerabilities,
      },
      { ...options, targetIsPlayer: participant.participantType === 'player' },
    );

    // Every application of the cap is announced. A cap that silently rewrote damage would be
    // indistinguishable, in a log, from an engine that had miscalculated it.
    if (result.damageCap) {
      logger.info({
        msg: 'COMBAT_DAMAGE_CAP_APPLIED',
        encounterId,
        participantId,
        participantName: participant.name ?? null,
        reason: result.damageCap.reason,
        rawDamage: result.damageCap.rawDamage,
        cappedTo: result.damageCap.cappedTo,
        ...(result.damageCap.fraction === undefined
          ? {}
          : { fraction: result.damageCap.fraction, maxHp: result.damageCap.maxHp }),
        currentHpBefore: status.currentHp,
        isCriticalHit: options.isCriticalHit === true,
        sourceDescription: sourceDescription ?? null,
      });
    }

    // 🛡️ Sentinel: Refactored to use atomic updates with existence checks for defense-in-depth.
    //
    // The HP write and the damage-log write used to be issued concurrently via
    // Promise.all and un-transacted. Two things were wrong with that:
    //
    //   1. The log write was an insert-select whose projection covered 7 of
    //      combat_damage_log's 9 columns, so Drizzle threw
    //      "Insert select error: selected fields are not the same..." on every
    //      single call. The rejection surfaced from Promise.all as a failed
    //      attack ("Attack succeeded but damage application failed"), which is
    //      how a pure telemetry write came to kill live attacks.
    //   2. Because the two ran concurrently, the HP update had usually already
    //      committed by the time the log rejected -- damage applied, attack
    //      reported as failed, and (since resolveAttack claims the actor's
    //      action first) the actor stranded with a spent action forever.
    //
    // The HP write is now awaited on its own -- as of PR2 of #1826 that is one
    // transaction covering the character record and its participant mirror -- and
    // the log is a plain insert issued afterwards under a catch. Ordering matters:
    // the log is deliberately NOT inside that transaction, because a failed INSERT
    // aborts the enclosing Postgres transaction, and a "best-effort" write that
    // can still roll back the gameplay state it is describing is not
    // best-effort at all.
    await this.writeThrough({
      participantId,
      encounterId,
      characterId: participant.characterId ?? null,
      userId,
      status: {
        currentHp: result.newCurrentHp,
        tempHp: result.newTempHp,
        isConscious: result.isConscious,
        deathSavesSuccesses: result.newDeathSavesSuccesses ?? status.deathSavesSuccesses,
        deathSavesFailures: result.newDeathSavesFailures,
      },
      character: {
        currentHitPoints: result.newCurrentHp,
        temporaryHitPoints: result.newTempHp,
        isConscious: result.isConscious,
        // Damage never adds successes. It only clears them: a fresh drop starts a new dying
        // sequence and a hit on a stable creature makes it dying again.
        deathSavesSuccesses: result.newDeathSavesSuccesses ?? status.deathSavesSuccesses,
        deathSavesFailures: result.newDeathSavesFailures,
      },
    });

    if (damageAmount > 0) {
      await touchEncounterActivity(encounterId);
    }

    // Telemetry only. The ownership check the old insert-select carried in its
    // WHERE clause is redundant here: the UPDATE above ran under the same
    // ownership filter and we threw NotFoundError just now if it matched no row,
    // so reaching this line already proves the caller owns this participant.
    if (damageAmount > 0) {
      try {
        await db.insert(combatDamageLog).values({
          encounterId,
          participantId,
          damageAmount: result.modifiedDamage,
          damageType: damageType || 'untyped',
          sourceParticipantId: sourceParticipantId || null,
          sourceDescription: sourceDescription || null,
          roundNumber: currentRound,
        });
      } catch (error) {
        // A damage log is a record of what happened, not part of what happened.
        // Losing one costs a row in a history table; failing the attack costs the
        // player their turn, permanently (see the comment above).
        logger.warn({
          msg: 'COMBAT_DAMAGE_LOG_FAILED',
          error,
          encounterId,
          participantId,
          damageAmount: result.modifiedDamage,
          roundNumber: currentRound,
        });
      }
    }

    return result;
  }

  /**
   * Heal damage on a participant
   * - Healing cannot exceed max HP
   * - Healing can revive unconscious characters (if they have 0 death save failures)
   */
  static async healDamage(
    participantId: string,
    encounterId: string,
    healingAmount: number,
    _sourceDescription?: string,
    userId?: string,
  ): Promise<HealingResult> {
    if (healingAmount < 0) {
      throw new ValidationError('Healing amount must be non-negative', { healingAmount });
    }

    // ⚡ Bolt: Consolidated authorization and data retrieval into a single query.
    const { participant, status } = await getParticipantWithFullContext(
      participantId,
      encounterId,
      userId,
    );

    // Delegate to HPMechanics
    const result = HPMechanics.calculateHealingResult(participantId, status, healingAmount);

    // Clear death saves if revived
    const deathSavesSuccesses = result.wasRevived ? 0 : status.deathSavesSuccesses;
    const deathSavesFailures = result.wasRevived ? 0 : status.deathSavesFailures;

    // 🛡️ Sentinel: Atomic update with ownership check, now carrying the character record with it.
    await this.writeThrough({
      participantId,
      encounterId,
      characterId: participant.characterId ?? null,
      userId,
      status: {
        currentHp: result.newCurrentHp,
        isConscious: result.isConscious,
        deathSavesSuccesses,
        deathSavesFailures,
      },
      character: {
        currentHitPoints: result.newCurrentHp,
        // 5E: healing restores hit points and never tops up the temporary pool, so the
        // character's temp HP is left exactly where it was.
        isConscious: result.isConscious,
        deathSavesSuccesses,
        deathSavesFailures,
      },
    });

    if (healingAmount > 0) {
      await touchEncounterActivity(encounterId);
    }

    return result;
  }

  /**
   * Set temporary HP for a participant
   * - Temp HP doesn't stack (always use higher value)
   * - Temp HP doesn't add to current HP
   */
  static async setTempHP(
    participantId: string,
    encounterId: string,
    tempHpAmount: number,
    userId?: string,
  ): Promise<{ participantId: string; oldTempHp: number; newTempHp: number }> {
    if (tempHpAmount < 0) {
      throw new ValidationError('Temporary HP amount must be non-negative', { tempHpAmount });
    }

    // ⚡ Bolt: Consolidated authorization and data retrieval into a single query.
    const { status } = await getParticipantWithFullContext(participantId, encounterId, userId);

    const oldTempHp = status.tempHp;

    // Temp HP doesn't stack - use higher value
    const newTempHp = Math.max(oldTempHp, tempHpAmount);

    // 🛡️ Sentinel: Atomic update with ownership check
    //
    // Not write-through. PR2 of #1826 covers the four paths that move hit points, and this is
    // not one of them: temporary hit points granted in a fight are spent in that fight, and the
    // next damage write mirrors whatever survives to the character record anyway.
    const [updated] = await db
      .update(combatParticipantStatus)
      .set({
        tempHp: newTempHp,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(combatParticipantStatus.participantId, participantId),
          userId ? this.getEncounterOwnershipFilter(participantId, encounterId, userId) : sql`true`,
        ),
      )
      .returning();

    if (userId && !updated) {
      throw new NotFoundError('Participant', participantId);
    }

    return {
      participantId,
      oldTempHp,
      newTempHp,
    };
  }

  /**
   * Roll a death save for an unconscious participant
   * - Natural 1 = 2 failures
   * - 2-9 = 1 failure
   * - 10-19 = 1 success
   * - Natural 20 = revive with 1 HP
   * - 3 successes = stabilized (unconscious but not dying)
   * - 3 failures = dead
   */
  static async rollDeathSave(
    participantId: string,
    encounterId: string,
    userId?: string,
    providedRoll?: number,
    /**
     * The tallies the caller read when it decided this save was owed. The write lands only while
     * the row still holds them, so a read-then-roll that raced another save is refused.
     */
    expectedTallies?: { successes: number; failures: number },
  ): Promise<DeathSaveResult> {
    // The player's own die when they rolled one; the engine rolls only when nobody did.
    const roll =
      providedRoll !== undefined &&
      Number.isInteger(providedRoll) &&
      providedRoll >= 1 &&
      providedRoll <= 20
        ? providedRoll
        : Math.floor(Math.random() * 20) + 1;

    // ⚡ Bolt: Consolidated authorization and data retrieval into a single query.
    const { participant, status } = await getParticipantWithFullContext(
      participantId,
      encounterId,
      userId,
    );

    if (status.isConscious) {
      throw new BusinessLogicError('Cannot roll death save for conscious participant', {
        participantId,
      });
    }
    // A stable creature rolls no more saves and a dead one rolls none at all (SRD 5.1).
    if (status.deathSavesFailures >= 3 || status.deathSavesSuccesses >= 3) {
      throw new BusinessLogicError('Cannot roll death save for a stable or dead participant', {
        participantId,
      });
    }

    // Delegate logic to HPMechanics
    const result = HPMechanics.resolveDeathSave(participantId, status, roll);

    // 🛡️ Sentinel: Atomic update with ownership check, now carrying the character record with it.
    // The progression rules are untouched: what the character row records is whatever
    // HPMechanics just decided.
    await this.writeThrough({
      participantId,
      encounterId,
      characterId: participant.characterId ?? null,
      userId,
      status: {
        currentHp: result.newCurrentHp,
        deathSavesSuccesses: result.successes,
        deathSavesFailures: result.failures,
        isConscious: result.wasRevived,
      },
      character: {
        currentHitPoints: result.newCurrentHp,
        isConscious: result.wasRevived,
        deathSavesSuccesses: result.successes,
        deathSavesFailures: result.failures,
      },
      expectedDying: expectedTallies ?? {
        successes: status.deathSavesSuccesses,
        failures: status.deathSavesFailures,
      },
      spendAction: true,
    });

    return result;
  }

  /**
   * Check if a participant is conscious
   */
  static async checkConscious(participantId: string, userId?: string): Promise<boolean> {
    const participant = await getParticipantStatusScoped(participantId, userId);

    if (!participant || !participant.status) {
      throw new NotFoundError('Participant', participantId);
    }

    return participant.status.isConscious;
  }

  /**
   * Get damage log for an encounter or specific participant.
   */
  static async getDamageLog(
    encounterId: string,
    participantId?: string,
    round?: number,
    userId?: string,
  ): Promise<CombatDamageLog[]> {
    return getDamageLog(encounterId, participantId, round, userId);
  }

  /**
   * Get participant status
   */
  static async getParticipantStatus(
    participantId: string,
    userId?: string,
  ): Promise<CombatParticipantStatus | null> {
    return getParticipantStatus(participantId, userId);
  }

  /**
   * Initialize status for a new participant
   */
  static async initializeParticipantStatus(
    participantId: string,
    maxHp: number,
    currentHp?: number,
  ): Promise<CombatParticipantStatus> {
    return initializeParticipantStatus(participantId, maxHp, currentHp);
  }

  /**
   * Stabilize a dying creature with a Medicine check
   * D&D 5E PHB p.197: "You can use your action to administer first aid to an unconscious creature
   * and attempt to stabilize it, which requires a successful DC 10 Wisdom (Medicine) check."
   *
   * A stable creature:
   * - Is still at 0 HP and unconscious
   * - No longer makes death saves
   * - Will regain 1 HP after 1d4 hours (if not healed sooner)
   */
  static async stabilizeWithMedicine(
    participantId: string,
    encounterId: string,
    roll: number,
    modifier: number,
    userId?: string,
  ): Promise<StabilizationResult> {
    // ⚡ Bolt: Consolidated authorization and data retrieval into a single query.
    const { participant, status } = await getParticipantWithFullContext(
      participantId,
      encounterId,
      userId,
    );

    // Can only stabilize unconscious creatures at 0 HP
    if (status.isConscious || status.currentHp > 0) {
      throw new BusinessLogicError('Cannot stabilize a conscious creature', { participantId });
    }

    // Check if already dead
    if (status.deathSavesFailures >= 3) {
      throw new BusinessLogicError('Cannot stabilize a dead creature', { participantId });
    }

    // Delegate logic to HPMechanics
    const result = HPMechanics.resolveStabilization(participantId, roll, modifier);

    if (result.success) {
      // 🛡️ Sentinel: Atomic update with ownership check, now carrying the character record with it.
      // Stabilize: clear death saves, mark as stable (still unconscious at 0 HP)
      await this.writeThrough({
        participantId,
        encounterId,
        characterId: participant.characterId ?? null,
        userId,
        status: {
          // A full success tally is how a stable creature reads at 0 HP (`vitalStateOf`):
          // cleared counters are indistinguishable from "dying, has not rolled yet", and a
          // stabilised creature is precisely the one who stops rolling.
          deathSavesSuccesses: 3,
          deathSavesFailures: 0,
          // Note: isConscious stays false, currentHp stays 0
          // The creature is stable but still unconscious
        },
        character: {
          currentHitPoints: status.currentHp,
          isConscious: status.isConscious,
          deathSavesSuccesses: 3,
          deathSavesFailures: 0,
          vitalState: 'stabilized',
        },
      });
    }

    return result;
  }
}
