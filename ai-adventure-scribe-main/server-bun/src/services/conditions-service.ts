/**
 * Conditions Service
 *
 * Handles D&D 5E condition management for combat participants.
 * Implements all 13 core conditions with mechanical effects tracking,
 * duration management, and saving throw logic.
 *
 * @module server/services/conditions-service
 */

import { sql } from 'drizzle-orm';

import { db } from '../../../db/client';
import { BusinessLogicError, NotFoundError } from '../lib/errors.js';
import { combatLogger } from '../lib/logger.js';
import { ConditionMechanics, CONDITION_HIERARCHY, INCOMPATIBLE_CONDITIONS } from './conditions/condition-mechanics.js';

import type {
  Condition,
  ConditionConflict,
  ConditionDurationType,
  ConditionLibraryEntry,
  MechanicalEffects,
  AggregatedMechanicalEffects,
  ParticipantCondition,
  ParticipantConditionWithDetails,
  SaveAbility,
} from '../types/combat.js';

/**
 * Row structure for encounter conditions query
 */
interface EncounterConditionRow {
  id: string;
  participant_id: string;
  condition_id: string;
  duration_type: string;
  duration_value: number | null;
  save_dc: number | null;
  save_ability: string | null;
  applied_at_round: number;
  expires_at_round: number | null;
  source_description: string | null;
  is_active: boolean;
  created_at: string;
  condition_name: string;
  condition_description: string;
  mechanical_effects: string;
  icon_name: string | null;
}

export class ConditionsService {
  /**
   * Verify encounter ownership via session campaign/character links.
   * Throws NOT_FOUND for missing or unauthorized encounters.
   */
  private static async verifyEncounterAccess(encounterId: string, userId: string): Promise<void> {
    const encounterAccess = await db.execute<Record<string, unknown>>(
      sql`
        SELECT ce.id
        FROM combat_encounters ce
        JOIN game_sessions gs ON gs.id = ce.session_id
        LEFT JOIN campaigns camp ON camp.id = gs.campaign_id
        LEFT JOIN characters char ON char.id = gs.character_id
        WHERE ce.id = ${encounterId}
          AND (camp.user_id = ${userId} OR char.user_id = ${userId} OR char.owner_id = ${userId})
        LIMIT 1
      `
    );

    if (!encounterAccess || encounterAccess.length === 0) {
      throw new NotFoundError('Encounter', encounterId);
    }
  }

  /**
   * Apply a condition to a combat participant
   */
  static async applyCondition(
    participantId: string,
    encounterId: string,
    conditionName: string,
    durationType: ConditionDurationType,
    durationValue?: number,
    saveDC?: number,
    saveAbility?: SaveAbility,
    source?: string,
    currentRound?: number,
    userId?: string
  ): Promise<{ condition: ParticipantConditionWithDetails; warnings: string[] }> {
    if (userId) {
      await this.verifyEncounterAccess(encounterId, userId);
    }

    const warnings: string[] = [];

    // Get condition from library
    const conditionLibrary = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM conditions_library WHERE name = ${conditionName} LIMIT 1`
    );

    if (!conditionLibrary || conditionLibrary.length === 0) {
      throw new NotFoundError('Condition', conditionName);
    }

    const conditionEntry = conditionLibrary[0] as unknown as ConditionLibraryEntry;

    // Get participant to get current round and verify encounterId
    const participantResult = await db.execute<Record<string, unknown>>(
      sql`SELECT encounter_id FROM combat_participants WHERE id = ${participantId} AND encounter_id = ${encounterId} LIMIT 1`
    );

    if (!participantResult || participantResult.length === 0) {
      throw new NotFoundError('Participant in encounter', participantId);
    }

    // Get current round from encounter if not provided
    let appliedAtRound = currentRound || 1;
    if (!currentRound) {
      const encounterResult = await db.execute<Record<string, unknown>>(
        sql`SELECT current_round FROM combat_encounters WHERE id = ${participantResult[0]!.encounter_id} LIMIT 1`
      );
      if (encounterResult && encounterResult.length > 0) {
        appliedAtRound = encounterResult[0]!.current_round as number;
      }
    }

    // Calculate expiry round
    let expiresAtRound: number | null = null;
    if (durationType === 'rounds' && durationValue) {
      expiresAtRound = appliedAtRound + durationValue;
    } else if (durationType === 'minutes' && durationValue) {
      // 1 minute = 10 rounds (60 seconds / 6 seconds per round)
      expiresAtRound = appliedAtRound + (durationValue * 10);
    } else if (durationType === 'hours' && durationValue) {
      // 1 hour = 600 rounds
      expiresAtRound = appliedAtRound + (durationValue * 600);
    }

    // Check for conflicts
    const conflicts = await this.checkConditionConflicts(participantId, conditionName);
    const supersededIds: string[] = [];

    conflicts.forEach(conflict => {
      warnings.push(conflict.message);
      // Collect superseded conditions for batch removal
      if (conflict.conflictType === 'superseded') {
        supersededIds.push(conflict.existingCondition.id);
      }
    });

    // ⚡ Bolt: Batch remove superseded conditions to avoid N+1 update pattern
    if (supersededIds.length > 0) {
      try {
        await db.execute(
          sql`
            UPDATE combat_participant_conditions
            SET is_active = false
            WHERE id IN (${sql.join(supersededIds.map(id => sql`${id}`), sql`, `)})
              AND participant_id IN (SELECT id FROM combat_participants WHERE encounter_id = ${encounterId})
          `
        );
      } catch (err) {
        combatLogger.error({ msg: 'Failed to remove superseded conditions', error: err, supersededIds });
      }
    }

    // Insert the condition
    const result = await db.execute<Record<string, unknown>>(
      sql`
        INSERT INTO combat_participant_conditions (
          participant_id,
          condition_id,
          duration_type,
          duration_value,
          save_dc,
          save_ability,
          applied_at_round,
          expires_at_round,
          source_description,
          is_active
        ) VALUES (
          ${participantId},
          ${conditionEntry.id},
          ${durationType},
          ${durationValue || null},
          ${saveDC || null},
          ${saveAbility || null},
          ${appliedAtRound},
          ${expiresAtRound},
          ${source || null},
          true
        )
        RETURNING *
      `
    );

    const participantCondition = result[0] as unknown as ParticipantCondition;

    // Parse mechanical effects
    const condition = this.parseCondition(conditionEntry);

    return {
      condition: {
        ...participantCondition,
        condition,
      },
      warnings,
    };
  }

  /**
   * Remove a condition from a participant
   */
  static async removeCondition(conditionId: string, encounterId: string, userId?: string): Promise<boolean> {
    if (userId) {
      await this.verifyEncounterAccess(encounterId, userId);
    }

    const result = await db.execute<Record<string, unknown>>(
      sql`
        UPDATE combat_participant_conditions
        SET is_active = false
        WHERE id = ${conditionId}
          AND participant_id IN (SELECT id FROM combat_participants WHERE encounter_id = ${encounterId})
        RETURNING id
      `
    );

    return result ? result.length > 0 : false;
  }

  /**
   * Attempt a saving throw against a condition
   */
  static async attemptSave(
    conditionId: string,
    encounterId: string,
    saveRoll: number,
    userId?: string
  ): Promise<{ saved: boolean; conditionRemoved: boolean; message: string }> {
    if (userId) {
      await this.verifyEncounterAccess(encounterId, userId);
    }

    // Get the condition and verify encounterId
    const result = await db.execute<Record<string, unknown>>(
      sql`
        SELECT cpc.* FROM combat_participant_conditions cpc
        JOIN combat_participants cp ON cp.id = cpc.participant_id
        WHERE cpc.id = ${conditionId} AND cpc.is_active = true
          AND cp.encounter_id = ${encounterId}
        LIMIT 1
      `
    );

    if (!result || result.length === 0) {
      throw new NotFoundError('Active condition in encounter', conditionId);
    }

    const condition = result[0] as unknown as ParticipantCondition;

    if (!condition.saveDc || !condition.saveAbility) {
      throw new BusinessLogicError('This condition does not require a saving throw', { conditionId });
    }

    const saved = saveRoll >= condition.saveDc;
    let conditionRemoved = false;
    let message = '';

    if (saved) {
      // Remove the condition
      await this.removeCondition(conditionId, encounterId, userId);
      conditionRemoved = true;
      message = `Saving throw successful (${saveRoll})! Condition removed.`;
    } else {
      message = `Saving throw failed (${saveRoll}). Condition persists.`;
    }

    return { saved, conditionRemoved, message };
  }

  /**
   * Get all active conditions for a participant
   * @param participantId - The participant ID
   * @param userId - Optional User ID for ownership verification
   */
  static async getActiveConditions(
    participantId: string,
    userId?: string
  ): Promise<ParticipantConditionWithDetails[]> {
    // ⚡ Bolt: Optimized to consolidate participant verification and condition retrieval into a single query.
    // This reduces database round-trips from 2 to 1 while maintaining strict ownership checks.
    // Using a LEFT JOIN from combat_participants ensures we can distinguish between "Participant not found/unauthorized" (0 rows)
    // and "Participant found but no active conditions" (1 row with null condition fields).
    const result = await db.execute<Record<string, unknown>>(
      sql`
        SELECT
          cp.id as participant_id,
          cpc.id as condition_instance_id,
          cpc.condition_id,
          cpc.duration_type,
          cpc.duration_value,
          cpc.save_dc,
          cpc.save_ability,
          cpc.applied_at_round,
          cpc.expires_at_round,
          cpc.source_description,
          cpc.is_active,
          cpc.created_at,
          cl.name as condition_name,
          cl.description as condition_description,
          cl.mechanical_effects,
          cl.icon_name
        FROM combat_participants cp
        ${
          userId
            ? sql`
        JOIN combat_encounters ce ON ce.id = cp.encounter_id
        JOIN game_sessions gs ON gs.id = ce.session_id
        LEFT JOIN campaigns camp ON camp.id = gs.campaign_id
        LEFT JOIN characters char ON char.id = gs.character_id
        `
            : sql``
        }
        LEFT JOIN combat_participant_conditions cpc ON cpc.participant_id = cp.id AND cpc.is_active = true
        LEFT JOIN conditions_library cl ON cl.id = cpc.condition_id
        WHERE cp.id = ${participantId}
          ${
            userId
              ? sql`AND (camp.user_id = ${userId} OR char.user_id = ${userId} OR char.owner_id = ${userId})`
              : sql``
          }
        ORDER BY cpc.applied_at_round DESC
      `
    );

    if (!result || result.length === 0) {
      if (userId) {
        throw new NotFoundError('Participant', participantId);
      }
      return [];
    }

    // Filter out rows where no condition was found (result of LEFT JOIN when participant is healthy)
    return (result || [])
      .filter((row: any) => row.condition_instance_id !== null)
      .map((row: any) => {
        const mechanicalEffects = this.parseMechanicalEffects(row.mechanical_effects);

        return {
          id: row.condition_instance_id,
          participantId: row.participant_id,
          conditionId: row.condition_id,
          durationType: row.duration_type as ConditionDurationType,
          durationValue: row.duration_value,
          saveDc: row.save_dc,
          saveAbility: row.save_ability as SaveAbility | null,
          appliedAtRound: row.applied_at_round,
          expiresAtRound: row.expires_at_round,
          sourceDescription: row.source_description,
          isActive: row.is_active,
          createdAt: new Date(row.created_at),
          condition: {
            id: row.condition_id,
            name: row.condition_name,
            description: row.condition_description,
            mechanicalEffects,
            iconName: row.icon_name,
            createdAt: new Date(row.created_at),
          },
        };
      });
  }

  /**
   * Get aggregated mechanical effects for a participant from all active conditions
   * @param participantId - The participant ID
   * @param userId - Optional User ID for ownership verification
   */
  static async getMechanicalEffects(
    participantId: string,
    userId?: string
  ): Promise<AggregatedMechanicalEffects> {
    // ⚡ Bolt: Removed redundant verification query.
    // getActiveConditions already performs consolidated verification and data retrieval.
    const conditions = await this.getActiveConditions(participantId, userId);
    return this.calculateAggregatedEffects(conditions);
  }

  /**
   * Get all active conditions for all participants in an encounter
   */
  static async getEncounterConditions(encounterId: string, userId?: string): Promise<
    Record<
      string,
      {
        conditions: ParticipantConditionWithDetails[];
        aggregatedEffects: AggregatedMechanicalEffects;
      }
    >
  > {
    // Verify encounter visibility for user-scoped calls to avoid leaking whether
    // an encounter exists.
    if (userId) {
      await this.verifyEncounterAccess(encounterId, userId);
    }

    const result = await db.execute<Record<string, unknown>>(
      sql`
        SELECT
          cpc.*,
          cl.name as condition_name,
          cl.description as condition_description,
          cl.mechanical_effects,
          cl.icon_name,
          cp.id as participant_id
        FROM combat_participant_conditions cpc
        JOIN conditions_library cl ON cl.id = cpc.condition_id
        JOIN combat_participants cp ON cp.id = cpc.participant_id
        ${
          userId
            ? sql`
        JOIN combat_encounters ce ON ce.id = cp.encounter_id
        JOIN game_sessions gs ON gs.id = ce.session_id
        LEFT JOIN campaigns camp ON camp.id = gs.campaign_id
        LEFT JOIN characters char ON char.id = gs.character_id
        `
            : sql``
        }
        WHERE cp.encounter_id = ${encounterId}
          AND cpc.is_active = true
          ${
            userId
              ? sql`AND (camp.user_id = ${userId} OR char.user_id = ${userId} OR char.owner_id = ${userId})`
              : sql``
          }
        ORDER BY cpc.applied_at_round DESC
      `
    );

    const participantsMap: Record<string, ParticipantConditionWithDetails[]> = {};

    const rows = (result || []) as unknown as EncounterConditionRow[];

    rows.forEach((row) => {
      const pid = row.participant_id;
      if (!participantsMap[pid]) participantsMap[pid] = [];

      const mechanicalEffects = this.parseMechanicalEffects(row.mechanical_effects);
      participantsMap[pid].push({
        id: row.id,
        participantId: row.participant_id,
        conditionId: row.condition_id,
        durationType: row.duration_type as ConditionDurationType,
        durationValue: row.duration_value,
        saveDc: row.save_dc,
        saveAbility: row.save_ability as SaveAbility | null,
        appliedAtRound: row.applied_at_round,
        expiresAtRound: row.expires_at_round,
        sourceDescription: row.source_description,
        isActive: row.is_active,
        createdAt: new Date(row.created_at),
        condition: {
          id: row.condition_id,
          name: row.condition_name,
          description: row.condition_description,
          mechanicalEffects,
          iconName: row.icon_name,
          createdAt: new Date(row.created_at),
        },
      });
    });

    const finalResult: Record<
      string,
      {
        conditions: ParticipantConditionWithDetails[];
        aggregatedEffects: AggregatedMechanicalEffects;
      }
    > = {};

    for (const [pid, conditions] of Object.entries(participantsMap)) {
      finalResult[pid] = {
        conditions,
        aggregatedEffects: this.calculateAggregatedEffects(conditions),
      };
    }

    return finalResult;
  }

  /**
   * Calculate aggregated mechanical effects from a list of conditions
   */
  static calculateAggregatedEffects(
    conditions: ParticipantConditionWithDetails[]
  ): AggregatedMechanicalEffects {
    return ConditionMechanics.calculateAggregatedEffects(conditions);
  }

  /**
   * Advance condition durations at the end of a round
   */
  static async advanceConditionDurations(
    encounterId: string,
    currentRound: number,
    userId?: string
  ): Promise<{
    expiredConditions: ParticipantConditionWithDetails[];
    savingThrowsNeeded: Array<{ participantId: string; conditionId: string; saveAbility: SaveAbility; saveDc: number }>;
  }> {
    if (userId) {
      await this.verifyEncounterAccess(encounterId, userId);
    }

    // Get all active conditions for this encounter's participants
    const result = await db.execute<Record<string, unknown>>(
      sql`
        SELECT
          cpc.*,
          cl.name as condition_name,
          cl.description as condition_description,
          cl.mechanical_effects,
          cl.icon_name,
          cp.id as participant_id
        FROM combat_participant_conditions cpc
        JOIN conditions_library cl ON cl.id = cpc.condition_id
        JOIN combat_participants cp ON cp.id = cpc.participant_id
        ${
          userId
            ? sql`
        JOIN combat_encounters ce ON ce.id = cp.encounter_id
        JOIN game_sessions gs ON gs.id = ce.session_id
        LEFT JOIN campaigns camp ON camp.id = gs.campaign_id
        LEFT JOIN characters char ON char.id = gs.character_id
        `
            : sql``
        }
        WHERE cp.encounter_id = ${encounterId}
          AND cpc.is_active = true
          ${
            userId
              ? sql`AND (camp.user_id = ${userId} OR char.user_id = ${userId} OR char.owner_id = ${userId})`
              : sql``
          }
      `
    );

    const expiredConditions: ParticipantConditionWithDetails[] = [];
    const savingThrowsNeeded: Array<{ participantId: string; conditionId: string; saveAbility: SaveAbility; saveDc: number }> = [];

    for (const rowData of (result || [])) {
      const row = rowData as any;
      // Check if condition has expired
      if (row.expires_at_round && row.expires_at_round <= currentRound) {
        const mechanicalEffects = this.parseMechanicalEffects(row.mechanical_effects);
        expiredConditions.push({
          id: row.id,
          participantId: row.participant_id,
          conditionId: row.condition_id,
          durationType: row.duration_type as ConditionDurationType,
          durationValue: row.duration_value,
          saveDc: row.save_dc,
          saveAbility: row.save_ability as SaveAbility | null,
          appliedAtRound: row.applied_at_round,
          expiresAtRound: row.expires_at_round,
          sourceDescription: row.source_description,
          isActive: false,
          createdAt: new Date(row.created_at),
          condition: {
            id: row.condition_id,
            name: row.condition_name,
            description: row.condition_description,
            mechanicalEffects,
            iconName: row.icon_name,
            createdAt: new Date(row.created_at),
          },
        });
      }
      // Check if condition requires a saving throw
      else if (row.duration_type === 'until_save' && row.save_dc && row.save_ability) {
        savingThrowsNeeded.push({
          participantId: row.participant_id,
          conditionId: row.id,
          saveAbility: row.save_ability as SaveAbility,
          saveDc: row.save_dc,
        });
      }
    }

    // ⚡ Bolt: Batch update all expired conditions in a single query instead of N updates.
    // This fixes an N+1 update pattern and significantly improves performance during turn advancement.
    // It also resolves a bug where encounterId was missing in the individual removeCondition calls.
    if (expiredConditions.length > 0) {
      const expiredIds = expiredConditions.map((c) => c.id);
      await db.execute(
        sql`
          UPDATE combat_participant_conditions
          SET is_active = false
          WHERE id IN (${sql.join(
            expiredIds.map((id) => sql`${id}`),
            sql`, `
          )})
            AND participant_id IN (
              SELECT cp.id FROM combat_participants cp
              ${
                userId
                  ? sql`
              JOIN combat_encounters ce ON ce.id = cp.encounter_id
              JOIN game_sessions gs ON gs.id = ce.session_id
              LEFT JOIN campaigns camp ON camp.id = gs.campaign_id
              LEFT JOIN characters char ON char.id = gs.character_id
              `
                  : sql``
              }
              WHERE cp.encounter_id = ${encounterId}
                ${
                  userId
                    ? sql`AND (camp.user_id = ${userId} OR char.user_id = ${userId} OR char.owner_id = ${userId})`
                    : sql``
                }
            )
        `
      );
    }

    return { expiredConditions, savingThrowsNeeded };
  }

  /**
   * Check for condition conflicts before applying
   */
  static async checkConditionConflicts(
    participantId: string,
    newConditionName: string,
    userId?: string
  ): Promise<ConditionConflict[]> {
    const activeConditions = await this.getActiveConditions(participantId, userId);
    const conflicts: ConditionConflict[] = [];

    for (const existingCondition of activeConditions) {
      const existingName = existingCondition.condition.name;

      // Check for duplicate
      if (existingName === newConditionName) {
        conflicts.push({
          existingCondition,
          newConditionName,
          conflictType: 'duplicate',
          message: `${newConditionName} is already applied to this participant`,
        });
      }

      // Check if new condition supersedes existing
      if (CONDITION_HIERARCHY[newConditionName]?.includes(existingName)) {
        conflicts.push({
          existingCondition,
          newConditionName,
          conflictType: 'superseded',
          message: `${newConditionName} includes ${existingName}, which will be removed`,
        });
      }

      // Check if existing condition supersedes new
      if (CONDITION_HIERARCHY[existingName]?.includes(newConditionName)) {
        conflicts.push({
          existingCondition,
          newConditionName,
          conflictType: 'superseded',
          message: `${existingName} already includes the effects of ${newConditionName}`,
        });
      }

      // Check for incompatibilities
      if (INCOMPATIBLE_CONDITIONS[newConditionName]?.includes(existingName)) {
        conflicts.push({
          existingCondition,
          newConditionName,
          conflictType: 'incompatible',
          message: `${newConditionName} is incompatible with ${existingName}`,
        });
      }
    }

    return conflicts;
  }

  /**
   * Get all available conditions from the library
   */
  static async getConditionsLibrary(): Promise<Condition[]> {
    const result = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM conditions_library ORDER BY name ASC`
    );

    return (result || []).map((row: any) => this.parseCondition(row as ConditionLibraryEntry));
  }

  /**
   * Parse a condition from the library
   */
  private static parseCondition(entry: ConditionLibraryEntry | any): Condition {
    return {
      id: entry.id,
      name: entry.name,
      description: entry.description,
      mechanicalEffects: this.parseMechanicalEffects(entry.mechanicalEffects || entry.mechanical_effects),
      iconName: entry.iconName || entry.icon_name || null,
      createdAt: new Date(entry.createdAt || entry.created_at),
    };
  }

  /**
   * Parse mechanical effects JSON string
   */
  private static parseMechanicalEffects(effectsJson: string): MechanicalEffects {
    try {
      return JSON.parse(effectsJson);
    } catch (error) {
      combatLogger.error({ msg: 'Failed to parse mechanical effects', error });
      return {};
    }
  }

  // ==========================================
  // D&D 5E Combat Integration Methods
  // ==========================================

  /**
   * Get attack roll modifiers for an attacker based on their conditions
   * Returns sources of advantage and disadvantage on the attacker's rolls
   */
  static async getAttackerModifiers(attackerId: string, userId?: string): Promise<{
    hasAdvantage: boolean;
    hasDisadvantage: boolean;
    reasons: string[];
  }> {
    const effects = await this.getMechanicalEffects(attackerId, userId);
    return ConditionMechanics.calculateAttackerModifiers(effects);
  }

  /**
   * Get attack modifiers against a target based on target's conditions
   * Returns sources of advantage/disadvantage when attacking the target
   */
  static async getTargetModifiers(
    targetId: string,
    attackType: 'melee' | 'ranged' | 'spell',
    distanceInFeet?: number,
    userId?: string
  ): Promise<{
    hasAdvantage: boolean;
    hasDisadvantage: boolean;
    isAutoCrit: boolean;
    reasons: string[];
  }> {
    const effects = await this.getMechanicalEffects(targetId, userId);
    return ConditionMechanics.calculateTargetModifiers(effects, attackType, distanceInFeet);
  }

  /**
   * Get saving throw modifiers for a participant
   * Returns auto-fail or advantage/disadvantage for a specific save type
   */
  static async getSaveModifiers(
    participantId: string,
    saveAbility: SaveAbility,
    userId?: string
  ): Promise<{
    autoFail: boolean;
    hasAdvantage: boolean;
    hasDisadvantage: boolean;
    reasons: string[];
  }> {
    const effects = await this.getMechanicalEffects(participantId, userId);
    return ConditionMechanics.calculateSaveModifiers(effects, saveAbility);
  }

  /**
   * Get ability check modifiers for a participant
   */
  static async getAbilityCheckModifiers(participantId: string, userId?: string): Promise<{
    hasDisadvantage: boolean;
    reasons: string[];
  }> {
    const effects = await this.getMechanicalEffects(participantId, userId);
    return ConditionMechanics.calculateAbilityCheckModifiers(effects);
  }

  /**
   * Check if participant can take actions
   */
  static async canTakeActions(
    participantId: string,
    userId?: string,
    effects?: AggregatedMechanicalEffects
  ): Promise<{
    canAct: boolean;
    canReact: boolean;
    reasons: string[];
  }> {
    // ⚡ Bolt: Use pre-fetched mechanical effects if available to avoid redundant DB call.
    const mechanicalEffects = effects || await this.getMechanicalEffects(participantId, userId);
    return ConditionMechanics.calculateActionRestrictions(mechanicalEffects);
  }

  /**
   * Get speed modifiers for a participant
   */
  static async getSpeedModifiers(
    participantId: string,
    userId?: string,
    effects?: AggregatedMechanicalEffects
  ): Promise<{
    speedMultiplier: number;
    speedOverride?: number;
    reasons: string[];
  }> {
    // ⚡ Bolt: Use pre-fetched mechanical effects if available to avoid redundant DB call.
    const mechanicalEffects = effects || await this.getMechanicalEffects(participantId, userId);
    return ConditionMechanics.calculateSpeedModifiers(mechanicalEffects);
  }
}
