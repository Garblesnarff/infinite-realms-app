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

import { and, desc, eq, exists, or } from 'drizzle-orm';

import { db } from '../../../db/client.js';
import {
  combatParticipants,
  combatParticipantStatus,
  combatDamageLog,
  combatEncounters,
  gameSessions,
  campaigns,
  characters,
  type CombatParticipantStatus,
  type CombatDamageLog,
} from '../../../db/schema/index.js';
import { NotFoundError, ValidationError, BusinessLogicError } from '../lib/errors.js';
import { HPMechanics } from './combat/hp-mechanics.js';

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
   * Verify encounter ownership through its session's campaign/character links.
   * Throws NOT_FOUND for both missing and unauthorized access.
   */
  private static async verifyEncounterAccess(encounterId: string, userId: string): Promise<void> {
    const [result] = await db
      .select({ id: combatEncounters.id })
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

    if (!result) {
      throw new NotFoundError('Combat encounter', encounterId);
    }
  }

  private static participantInEncounterExists(participantId: string, encounterId: string): any {
    return exists(
      db.select()
        .from(combatParticipants)
        .where(and(
          eq(combatParticipants.id, participantId),
          eq(combatParticipants.encounterId, encounterId)
        ))
    );
  }

  /**
   * Fetch participant status, optionally scoped by user ownership.
   * When userId is provided, unauthorized and missing participants both return null.
   */
  private static async getParticipantStatusScoped(
    participantId: string,
    userId?: string
  ): Promise<{ encounterId: string; status: CombatParticipantStatus | null } | null> {
    if (userId) {
      const [scopedParticipant] = await db
        .select({
          encounterId: combatParticipants.encounterId,
          status: combatParticipantStatus,
        })
        .from(combatParticipants)
        .leftJoin(combatParticipantStatus, eq(combatParticipantStatus.participantId, combatParticipants.id))
        .innerJoin(combatEncounters, eq(combatParticipants.encounterId, combatEncounters.id))
        .innerJoin(gameSessions, eq(combatEncounters.sessionId, gameSessions.id))
        .leftJoin(campaigns, eq(gameSessions.campaignId, campaigns.id))
        .leftJoin(characters, eq(gameSessions.characterId, characters.id))
        .where(and(
          eq(combatParticipants.id, participantId),
          or(
            eq(campaigns.userId, userId),
            eq(characters.userId, userId),
            eq(characters.ownerId, userId)
          )
        ))
        .limit(1);

      if (!scopedParticipant) {
        return null;
      }

      return {
        encounterId: scopedParticipant.encounterId,
        status: scopedParticipant.status,
      };
    }

    const participant = await db.query.combatParticipants.findFirst({
      where: eq(combatParticipants.id, participantId),
      with: {
        status: true,
      },
    });

    if (!participant) {
      return null;
    }

    return {
      encounterId: participant.encounterId,
      status: participant.status || null,
    };
  }

  /**
   * Apply damage to a participant with D&D 5E rules
   * - Temp HP shields damage before real HP
   * - Resistance = half damage (round down)
   * - Vulnerability = double damage
   * - Immunity = 0 damage
   * - Massive damage (damage >= max HP while at 0 HP) = instant death
   */
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
    if (userId) {
      await this.verifyEncounterAccess(encounterId, userId);
    }

    const {
      damageAmount,
      damageType,
      sourceParticipantId,
      sourceDescription,
    } = options;

    // Get participant, status, and encounter in a single query if not pre-fetched
    const participant = preFetchedParticipant || await db.query.combatParticipants.findFirst({
      where: and(
        eq(combatParticipants.id, participantId),
        eq(combatParticipants.encounterId, encounterId)
      ),
      with: {
        status: true,
        encounter: true,
      },
    });

    if (!participant) {
      throw new NotFoundError('Participant', participantId);
    }

    if (!participant.status) {
      throw new BusinessLogicError('Participant has no status record', { participantId });
    }

    // Delegate pure logic to HPMechanics
    const result = HPMechanics.calculateDamageResult(
      participantId,
      participant.status,
      {
        damageImmunities: participant.damageImmunities,
        damageResistances: participant.damageResistances,
        damageVulnerabilities: participant.damageVulnerabilities,
      },
      options
    );

    // ⚡ Bolt: Parallelize status update and damage logging to reduce sequential database round-trips.
    // ⚡ Bolt: Skips redundant participantInEncounterExists subquery if data was already verified/pre-fetched.
    const updatePromise = db
      .update(combatParticipantStatus)
      .set({
        currentHp: result.newCurrentHp,
        tempHp: result.newTempHp,
        isConscious: result.isConscious,
        deathSavesFailures: result.newDeathSavesFailures,
        updatedAt: new Date(),
      })
      .where(and(
        eq(combatParticipantStatus.participantId, participantId),
        preFetchedParticipant
          ? undefined
          : this.participantInEncounterExists(participantId, encounterId)
      ))
      .returning();

    let logPromise = Promise.resolve() as any;
    if (damageAmount > 0) {
      // ⚡ Bolt: Use joined encounter data instead of fetching it again
      const encounter = (participant as any).encounter;

      logPromise = db.insert(combatDamageLog).values({
        encounterId: participant.encounterId,
        participantId,
        damageAmount: result.modifiedDamage,
        damageType: damageType || 'untyped',
        sourceParticipantId: sourceParticipantId || null,
        sourceDescription: sourceDescription || null,
        roundNumber: encounter?.currentRound || 1,
      });
    }

    await Promise.all([updatePromise, logPromise]);

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
    if (userId) {
      await this.verifyEncounterAccess(encounterId, userId);
    }

    if (healingAmount < 0) {
      throw new ValidationError('Healing amount must be non-negative', { healingAmount });
    }

    const participant = await db.query.combatParticipants.findFirst({
      where: and(
        eq(combatParticipants.id, participantId),
        eq(combatParticipants.encounterId, encounterId)
      ),
      with: {
        status: true,
      },
    });

    if (!participant || !participant.status) {
      throw new NotFoundError('Participant', participantId);
    }

    // Delegate to HPMechanics
    const result = HPMechanics.calculateHealingResult(
      participantId,
      participant.status,
      healingAmount
    );

    // Clear death saves if revived
    const deathSavesSuccesses = result.wasRevived ? 0 : participant.status.deathSavesSuccesses;
    const deathSavesFailures = result.wasRevived ? 0 : participant.status.deathSavesFailures;

    // Update status
    await db
      .update(combatParticipantStatus)
      .set({
        currentHp: result.newCurrentHp,
        isConscious: result.isConscious,
        deathSavesSuccesses,
        deathSavesFailures,
        updatedAt: new Date(),
      })
      .where(and(
        eq(combatParticipantStatus.participantId, participantId),
        this.participantInEncounterExists(participantId, encounterId)
      ));

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
    if (userId) {
      await this.verifyEncounterAccess(encounterId, userId);
    }

    if (tempHpAmount < 0) {
      throw new ValidationError('Temporary HP amount must be non-negative', { tempHpAmount });
    }

    const participant = await db.query.combatParticipants.findFirst({
      where: and(
        eq(combatParticipants.id, participantId),
        eq(combatParticipants.encounterId, encounterId)
      ),
      with: {
        status: true,
      },
    });

    if (!participant || !participant.status) {
      throw new NotFoundError('Participant', participantId);
    }

    const status = participant.status;
    const oldTempHp = status.tempHp;

    // Temp HP doesn't stack - use higher value
    const newTempHp = Math.max(oldTempHp, tempHpAmount);

    // Update status
    await db
      .update(combatParticipantStatus)
      .set({
        tempHp: newTempHp,
        updatedAt: new Date(),
      })
      .where(and(
        eq(combatParticipantStatus.participantId, participantId),
        this.participantInEncounterExists(participantId, encounterId)
      ));

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
    roll: number,
    userId?: string
  ): Promise<DeathSaveResult> {
    if (userId) {
      await this.verifyEncounterAccess(encounterId, userId);
    }

    if (roll < 1 || roll > 20) {
      throw new ValidationError('Death save roll must be between 1 and 20', { roll });
    }

    const participant = await db.query.combatParticipants.findFirst({
      where: and(
        eq(combatParticipants.id, participantId),
        eq(combatParticipants.encounterId, encounterId)
      ),
      with: {
        status: true,
      },
    });

    if (!participant || !participant.status) {
      throw new NotFoundError('Participant', participantId);
    }

    const status = participant.status;

    if (status.isConscious) {
      throw new BusinessLogicError('Cannot roll death save for conscious participant', { participantId });
    }

    // Delegate logic to HPMechanics
    const result = HPMechanics.resolveDeathSave(participantId, status, roll);

    // Update status
    await db
      .update(combatParticipantStatus)
      .set({
        currentHp: result.newCurrentHp,
        deathSavesSuccesses: result.successes,
        deathSavesFailures: result.failures,
        isConscious: result.wasRevived,
        updatedAt: new Date(),
      })
      .where(and(
        eq(combatParticipantStatus.participantId, participantId),
        this.participantInEncounterExists(participantId, encounterId)
      ));

    return result;
  }

  /**
   * Check if a participant is conscious
   */
  static async checkConscious(participantId: string, userId?: string): Promise<boolean> {
    const participant = await this.getParticipantStatusScoped(participantId, userId);

    if (!participant || !participant.status) {
      throw new NotFoundError('Participant', participantId);
    }

    return participant.status.isConscious;
  }

  /**
   * Get damage log for an encounter or specific participant
   */
  static async getDamageLog(
    encounterId: string,
    participantId?: string,
    round?: number,
    userId?: string
  ): Promise<CombatDamageLog[]> {
    if (userId) {
      await this.verifyEncounterAccess(encounterId, userId);
    }

    const conditions = [eq(combatDamageLog.encounterId, encounterId)];

    if (participantId) {
      conditions.push(eq(combatDamageLog.participantId, participantId));
    }

    if (round !== undefined) {
      conditions.push(eq(combatDamageLog.roundNumber, round));
    }

    const logs = await db.query.combatDamageLog.findMany({
      where: conditions.length > 1 ? and(...conditions) : conditions[0],
      orderBy: [desc(combatDamageLog.createdAt)],
    });

    return logs;
  }

  /**
   * Get participant status
   */
  static async getParticipantStatus(
    participantId: string,
    userId?: string
  ): Promise<CombatParticipantStatus | null> {
    const participant = await this.getParticipantStatusScoped(participantId, userId);

    if (!participant) {
      return null;
    }

    return participant.status || null;
  }

  /**
   * Initialize status for a new participant
   */
  static async initializeParticipantStatus(
    participantId: string,
    maxHp: number,
    currentHp?: number
  ): Promise<CombatParticipantStatus> {
    const [status] = await db
      .insert(combatParticipantStatus)
      .values({
        participantId,
        maxHp,
        currentHp: currentHp !== undefined ? currentHp : maxHp,
        tempHp: 0,
        isConscious: true,
        deathSavesSuccesses: 0,
        deathSavesFailures: 0,
      })
      .returning();

    if (!status) {
      throw new NotFoundError('Failed to initialize participant status', participantId);
    }

    return status;
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
    if (userId) {
      await this.verifyEncounterAccess(encounterId, userId);
    }

    const participant = await db.query.combatParticipants.findFirst({
      where: and(
        eq(combatParticipants.id, participantId),
        eq(combatParticipants.encounterId, encounterId)
      ),
      with: {
        status: true,
      },
    });

    if (!participant || !participant.status) {
      throw new NotFoundError('Participant', participantId);
    }

    const status = participant.status;

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
      // Stabilize: clear death saves, mark as stable (still unconscious at 0 HP)
      await db
        .update(combatParticipantStatus)
        .set({
          deathSavesSuccesses: 0,
          deathSavesFailures: 0,
          // Note: isConscious stays false, currentHp stays 0
          // The creature is stable but still unconscious
          updatedAt: new Date(),
        })
        .where(and(
          eq(combatParticipantStatus.participantId, participantId),
          this.participantInEncounterExists(participantId, encounterId)
        ));
    }

    return result;
  }
}
