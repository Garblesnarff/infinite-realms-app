/* eslint-disable max-lines, @typescript-eslint/no-explicit-any */
/**
 * Combat HP Service
 *
 * Handles HP tracking, damage application, healing, temp HP, and death saves
 * for D&D 5E combat encounters. Implements all D&D 5E rules for damage resistance,
 * vulnerability, temporary hit points, and death saving throws.
 *
 * @module server/services/combat-hp-service
 */

import { and, eq, exists, or, sql } from 'drizzle-orm';

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

import type { CombatParticipantStatus, CombatDamageLog } from '../../../db/schema/index';
import type {
  DamageResult,
  HealingResult,
  DeathSaveResult,
  StabilizationResult,
  ApplyDamageOptions,
} from '../types/combat.js';

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
    // The HP update is now awaited on its own, and the log is a plain insert
    // issued afterwards under a catch. Ordering matters: the log is deliberately
    // NOT inside a transaction with the HP update, because a failed INSERT
    // aborts the enclosing Postgres transaction, and a "best-effort" write that
    // can still roll back the gameplay state it is describing is not
    // best-effort at all.
    const updateResult = await db
      .update(combatParticipantStatus)
      .set({
        currentHp: result.newCurrentHp,
        tempHp: result.newTempHp,
        isConscious: result.isConscious,
        deathSavesFailures: result.newDeathSavesFailures,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(combatParticipantStatus.participantId, participantId),
          userId ? this.getEncounterOwnershipFilter(participantId, encounterId, userId) : sql`true`,
        ),
      )
      .returning();

    if (userId && (!updateResult || updateResult.length === 0)) {
      throw new NotFoundError('Participant', participantId);
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
    const { status } = await getParticipantWithFullContext(participantId, encounterId, userId);

    // Delegate to HPMechanics
    const result = HPMechanics.calculateHealingResult(participantId, status, healingAmount);

    // Clear death saves if revived
    const deathSavesSuccesses = result.wasRevived ? 0 : status.deathSavesSuccesses;
    const deathSavesFailures = result.wasRevived ? 0 : status.deathSavesFailures;

    // 🛡️ Sentinel: Atomic update with ownership check
    const [updated] = await db
      .update(combatParticipantStatus)
      .set({
        currentHp: result.newCurrentHp,
        isConscious: result.isConscious,
        deathSavesSuccesses,
        deathSavesFailures,
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
  ): Promise<DeathSaveResult> {
    const roll = Math.floor(Math.random() * 20) + 1;

    // ⚡ Bolt: Consolidated authorization and data retrieval into a single query.
    const { status } = await getParticipantWithFullContext(participantId, encounterId, userId);

    if (status.isConscious) {
      throw new BusinessLogicError('Cannot roll death save for conscious participant', {
        participantId,
      });
    }

    // Delegate logic to HPMechanics
    const result = HPMechanics.resolveDeathSave(participantId, status, roll);

    // 🛡️ Sentinel: Atomic update with ownership check
    const [updated] = await db
      .update(combatParticipantStatus)
      .set({
        currentHp: result.newCurrentHp,
        deathSavesSuccesses: result.successes,
        deathSavesFailures: result.failures,
        isConscious: result.wasRevived,
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
    const { status } = await getParticipantWithFullContext(participantId, encounterId, userId);

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
      // 🛡️ Sentinel: Atomic update with ownership check
      // Stabilize: clear death saves, mark as stable (still unconscious at 0 HP)
      const [updated] = await db
        .update(combatParticipantStatus)
        .set({
          deathSavesSuccesses: 0,
          deathSavesFailures: 0,
          // Note: isConscious stays false, currentHp stays 0
          // The creature is stable but still unconscious
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(combatParticipantStatus.participantId, participantId),
            userId
              ? this.getEncounterOwnershipFilter(participantId, encounterId, userId)
              : sql`true`,
          ),
        )
        .returning();

      if (userId && !updated) {
        throw new NotFoundError('Participant', participantId);
      }
    }

    return result;
  }
}
