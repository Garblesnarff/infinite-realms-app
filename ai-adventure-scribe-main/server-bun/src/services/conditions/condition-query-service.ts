/**
 * Condition Query Service
 *
 * Handles database queries and library lookups for D&D 5E conditions.
 * Extracted from ConditionsService to separate concerns.
 *
 * @module server/services/conditions/condition-query-service
 */

import { sql } from 'drizzle-orm';

import { db } from '../../../../db/client';
import { NotFoundError } from '../../lib/errors.js';
import { combatLogger } from '../../lib/logger.js';

import type {
  Condition,
  ConditionDurationType,
  ConditionLibraryEntry,
  MechanicalEffects,
  ParticipantConditionWithDetails,
  SaveAbility,
} from '../../types/combat.js';

/**
 * Row structure for encounter conditions query
 */
export interface EncounterConditionRow {
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

export class ConditionQueryService {
  /**
   * Get all active conditions for a participant
   * @param participantId - The participant ID
   * @param userId - Optional User ID for ownership verification
   */
  static async getActiveConditions(
    participantId: string,
    userId?: string
  ): Promise<ParticipantConditionWithDetails[]> {
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
   * Get all active conditions for all participants in an encounter
   */
  static async getEncounterConditions(encounterId: string, userId?: string): Promise<
    Record<
      string,
      {
        conditions: ParticipantConditionWithDetails[];
      }
    >
  > {
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
      }
    > = {};

    for (const [pid, conditions] of Object.entries(participantsMap)) {
      finalResult[pid] = {
        conditions,
      };
    }

    return finalResult;
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
  static parseCondition(entry: ConditionLibraryEntry | any): Condition {
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
  static parseMechanicalEffects(effectsJson: string): MechanicalEffects {
    try {
      return JSON.parse(effectsJson);
    } catch (error) {
      combatLogger.error({ msg: 'Failed to parse mechanical effects', error });
      return {};
    }
  }
}
