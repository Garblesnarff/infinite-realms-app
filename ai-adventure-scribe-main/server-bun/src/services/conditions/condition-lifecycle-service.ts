/**
 * Condition Lifecycle Service
 *
 * Extracted from ConditionsService.
 * Handles the application, removal, and duration management of conditions.
 */

import { sql } from 'drizzle-orm';

import { ConditionMechanics } from './condition-mechanics.js';
import { ConditionQueryService } from './condition-query-service.js';
import { db } from '../../../../db/client';
import { BusinessLogicError, NotFoundError } from '../../lib/errors.js';
import { combatLogger } from '../../lib/logger.js';

import type {
  ConditionDurationType,
  ConditionLibraryEntry,
  ParticipantCondition,
  ParticipantConditionWithDetails,
  SaveAbility,
} from '../../types/combat.js';

export class ConditionLifecycleService {
  /**
   * Verify encounter ownership via session campaign/character links.
   * Throws NOT_FOUND for missing or unauthorized encounters.
   */
  static async verifyEncounterAccess(encounterId: string, userId: string): Promise<void> {
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

    // Check for conflicts - Note: This will be moved to ConditionMechanics in the next step
    // For now, we use a placeholder or assume it's available in ConditionMechanics
    const conflicts = await ConditionMechanics.checkConditionConflicts(participantId, conditionName, userId);
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
      } catch (err) {
        combatLogger.error({ msg: 'Failed to remove superseded conditions', error: err, supersededIds });
      }
    }

    // Insert the condition
    // 🛡️ Sentinel: Refactored to use atomic INSERT ... SELECT for ownership verification.
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
        )
        SELECT
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
        WHERE cp.id = ${participantId} AND cp.encounter_id = ${encounterId}
        ${
          userId
            ? sql`AND (camp.user_id = ${userId} OR char.user_id = ${userId} OR char.owner_id = ${userId})`
            : sql``
        }
        RETURNING *
      `
    );

    const participantCondition = result[0] as unknown as ParticipantCondition;

    if (userId && !participantCondition) {
      // 🛡️ Sentinel: Throw NotFoundError for unauthorized access to mask resource existence.
      throw new NotFoundError('Participant in encounter', participantId);
    }

    // Parse mechanical effects
    const condition = ConditionQueryService.parseCondition(conditionEntry);

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

    // 🛡️ Sentinel: Refactored to use atomic UPDATE with ownership verification.
    const result = await db.execute<Record<string, unknown>>(
      sql`
        UPDATE combat_participant_conditions
        SET is_active = false
        WHERE id = ${conditionId}
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
    // 🛡️ Sentinel: Refactored to use atomic SELECT with ownership verification.
    const result = await db.execute<Record<string, unknown>>(
      sql`
        SELECT cpc.* FROM combat_participant_conditions cpc
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
        WHERE cpc.id = ${conditionId} AND cpc.is_active = true
          AND cp.encounter_id = ${encounterId}
          ${
            userId
              ? sql`AND (camp.user_id = ${userId} OR char.user_id = ${userId} OR char.owner_id = ${userId})`
              : sql``
          }
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
      const row = rowData as {
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
        condition_name: string;
        condition_description: string;
        mechanical_effects: unknown;
        icon_name: string | null;
        created_at: string;
      };
      // Check if condition has expired
      if (row.expires_at_round && row.expires_at_round <= currentRound) {
        const mechanicalEffects = ConditionQueryService.parseMechanicalEffects(row.mechanical_effects);
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
}
