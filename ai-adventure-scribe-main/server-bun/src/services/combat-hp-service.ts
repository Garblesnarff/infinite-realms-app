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
import {
  getParticipantWithFullContext,
  getParticipantStatusScoped,
  getDamageLog,
  getParticipantStatus,
  initializeParticipantStatus,
} from './combat/hp-data-access.js';
import { HPMechanics } from './combat/hp-mechanics.js';
import { CombatInitiativeService } from './combat-initiative-service.js';

import type {
  CombatParticipantStatus,
  CombatDamageLog,
} from '../../../db/schema/index';
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
    preFetchedParticipant?: any
  ): Promise<DamageResult> {
    const {
      damageAmount,
      damageType,
      sourceParticipantId,
      sourceDescription,
    } = options;

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

    // Delegate pure logic to HPMechanics
    const result = HPMechanics.calculateDamageResult(
      participantId,
      status,
      {
        damageImmunities: participant.damageImmunities,
        damageResistances: participant.damageResistances,
        damageVulnerabilities: participant.damageVulnerabilities,
      },
      options
    );

    // 🛡️ Sentinel: Refactored to use atomic updates with existence checks for defense-in-depth.
    // ⚡ Bolt: Parallelize status update and damage logging to reduce sequential database round-trips.
    const updatePromise = db
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
      );

    let logPromise = Promise.resolve() as any;
    if (damageAmount > 0) {
      logPromise = db.insert(combatDamageLog).select(
        db
          .select({
            encounterId: sql`${encounterId}`,
            participantId: sql`${participantId}`,
            damageAmount: sql`${result.modifiedDamage}`,
            damageType: sql`${damageType || 'untyped'}`,
            sourceParticipantId: sql`${sourceParticipantId || null}`,
            sourceDescription: sql`${sourceDescription || null}`,
            roundNumber: sql`${currentRound}`,
          })
          .from(combatParticipants)
          .innerJoin(combatEncounters, eq(combatParticipants.encounterId, combatEncounters.id))
          .innerJoin(gameSessions, eq(combatEncounters.sessionId, gameSessions.id))
          .leftJoin(campaigns, eq(gameSessions.campaignId, campaigns.id))
          .leftJoin(characters, eq(gameSessions.characterId, characters.id))
          .where(
            and(
              eq(combatParticipants.id, participantId),
              eq(combatParticipants.encounterId, encounterId),
              userId
                ? or(
                    eq(campaigns.userId, userId),
                    eq(characters.userId, userId),
                    eq(characters.ownerId, userId),
                  )
                : sql`true`,
            ),
          ),
      );
    }

    const [updateResult] = await Promise.all([updatePromise.returning(), logPromise]);

    if (userId && (!updateResult || updateResult.length === 0)) {
      throw new NotFoundError('Participant', participantId);
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
    userId?: string
  ): Promise<HealingResult> {
    if (healingAmount < 0) {
      throw new ValidationError('Healing amount must be non-negative', { healingAmount });
    }

    // ⚡ Bolt: Consolidated authorization and data retrieval into a single query.
    const { status } = await getParticipantWithFullContext(participantId, encounterId, userId);

    // Delegate to HPMechanics
    const result = HPMechanics.calculateHealingResult(
      participantId,
      status,
      healingAmount
    );

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
    userId?: string
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
    userId?: string
  ): Promise<DeathSaveResult> {
    const roll = Math.floor(Math.random() * 20) + 1;

    // ⚡ Bolt: Consolidated authorization and data retrieval into a single query.
    const { status } = await getParticipantWithFullContext(participantId, encounterId, userId);

    if (status.isConscious) {
      throw new BusinessLogicError('Cannot roll death save for conscious participant', { participantId });
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
    userId?: string
  ): Promise<CombatDamageLog[]> {
    return getDamageLog(encounterId, participantId, round, userId);
  }

  /**
   * Get participant status
   */
  static async getParticipantStatus(
    participantId: string,
    userId?: string
  ): Promise<CombatParticipantStatus | null> {
    return getParticipantStatus(participantId, userId);
  }

  /**
   * Initialize status for a new participant
   */
  static async initializeParticipantStatus(
    participantId: string,
    maxHp: number,
    currentHp?: number
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
    userId?: string
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
            userId ? this.getEncounterOwnershipFilter(participantId, encounterId, userId) : sql`true`,
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
