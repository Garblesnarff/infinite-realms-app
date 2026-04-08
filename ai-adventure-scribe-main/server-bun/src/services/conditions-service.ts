/**
 * Conditions Service
 *
 * Handles D&D 5E condition management for combat participants.
 * Implements all 13 core conditions with mechanical effects tracking,
 * duration management, and saving throw logic.
 *
 * @module server/services/conditions-service
 */

import { ConditionLifecycleService } from './conditions/condition-lifecycle-service.js';
import { ConditionMechanics } from './conditions/condition-mechanics.js';
import { ConditionQueryService } from './conditions/condition-query-service.js';
import { ConditionResolutionService } from './conditions/condition-resolution-service.js';

import type {
  Condition,
  ConditionConflict,
  ConditionDurationType,
  AggregatedMechanicalEffects,
  ParticipantConditionWithDetails,
  SaveAbility,
} from '../types/combat.js';

export class ConditionsService {
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
    return ConditionLifecycleService.applyCondition(
      participantId,
      encounterId,
      conditionName,
      durationType,
      durationValue,
      saveDC,
      saveAbility,
      source,
      currentRound,
      userId
    );
  }

  /**
   * Remove a condition from a participant
   */
  static async removeCondition(conditionId: string, encounterId: string, userId?: string): Promise<boolean> {
    return ConditionLifecycleService.removeCondition(conditionId, encounterId, userId);
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
    return ConditionLifecycleService.attemptSave(conditionId, encounterId, saveRoll, userId);
  }

  /**
   * Get all active conditions for a participant
   * @param participantId - The participant ID
   * @param userId - Optional User ID for ownership verification
   * @deprecated Use ConditionQueryService.getActiveConditions instead
   */
  static async getActiveConditions(
    participantId: string,
    userId?: string
  ): Promise<ParticipantConditionWithDetails[]> {
    return ConditionQueryService.getActiveConditions(participantId, userId);
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
    const conditions = await ConditionQueryService.getActiveConditions(participantId, userId);
    return this.calculateAggregatedEffects(conditions);
  }

  /**
   * Get all active conditions for all participants in an encounter
   * @deprecated Use ConditionQueryService.getEncounterConditions instead
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
    if (userId) {
      await ConditionLifecycleService.verifyEncounterAccess(encounterId, userId);
    }

    const result = await ConditionQueryService.getEncounterConditions(encounterId, userId);

    const finalResult: Record<
      string,
      {
        conditions: ParticipantConditionWithDetails[];
        aggregatedEffects: AggregatedMechanicalEffects;
      }
    > = {};

    for (const [pid, data] of Object.entries(result)) {
      finalResult[pid] = {
        conditions: data.conditions,
        aggregatedEffects: this.calculateAggregatedEffects(data.conditions),
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
    return ConditionLifecycleService.advanceConditionDurations(encounterId, currentRound, userId);
  }

  /**
   * Check for condition conflicts before applying
   */
  static async checkConditionConflicts(
    participantId: string,
    newConditionName: string,
    userId?: string
  ): Promise<ConditionConflict[]> {
    return ConditionMechanics.checkConditionConflicts(participantId, newConditionName, userId);
  }

  /**
   * Get all available conditions from the library
   * @deprecated Use ConditionQueryService.getConditionsLibrary instead
   */
  static async getConditionsLibrary(): Promise<Condition[]> {
    return ConditionQueryService.getConditionsLibrary();
  }

  // ==========================================
  // D&D 5E Combat Integration Methods
  // ==========================================

  /**
   * Get attack roll modifiers for an attacker based on their conditions
   * Returns sources of advantage and disadvantage on the attacker's rolls
   * @deprecated Use ConditionResolutionService.getAttackerModifiers instead
   */
  static async getAttackerModifiers(attackerId: string, userId?: string): Promise<{
    hasAdvantage: boolean;
    hasDisadvantage: boolean;
    reasons: string[];
  }> {
    return ConditionResolutionService.getAttackerModifiers(attackerId, userId);
  }

  /**
   * Get attack modifiers against a target based on target's conditions
   * Returns sources of advantage/disadvantage when attacking the target
   * @deprecated Use ConditionResolutionService.getTargetModifiers instead
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
    return ConditionResolutionService.getTargetModifiers(targetId, attackType, distanceInFeet, userId);
  }

  /**
   * Get saving throw modifiers for a participant
   * Returns auto-fail or advantage/disadvantage for a specific save type
   * @deprecated Use ConditionResolutionService.getSaveModifiers instead
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
    return ConditionResolutionService.getSaveModifiers(participantId, saveAbility, userId);
  }

  /**
   * Get ability check modifiers for a participant
   * @deprecated Use ConditionResolutionService.getAbilityCheckModifiers instead
   */
  static async getAbilityCheckModifiers(participantId: string, userId?: string): Promise<{
    hasDisadvantage: boolean;
    reasons: string[];
  }> {
    return ConditionResolutionService.getAbilityCheckModifiers(participantId, userId);
  }

  /**
   * Check if participant can take actions
   * @deprecated Use ConditionResolutionService.canTakeActions instead
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
    return ConditionResolutionService.canTakeActions(participantId, userId, effects);
  }

  /**
   * Get speed modifiers for a participant
   * @deprecated Use ConditionResolutionService.getSpeedModifiers instead
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
    return ConditionResolutionService.getSpeedModifiers(participantId, userId, effects);
  }
}
