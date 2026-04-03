/**
 * Condition Resolution Service
 *
 * Extracted from ConditionsService.
 * Handles D&D 5E combat rule resolution based on active conditions,
 * such as calculating roll modifiers and action restrictions.
 *
 * @module server/services/conditions/condition-resolution-service
 */

import { ConditionsService } from '../conditions-service.js';
import { ConditionMechanics } from './condition-mechanics.js';

import type {
  AggregatedMechanicalEffects,
  SaveAbility,
} from '../../types/combat.js';

export class ConditionResolutionService {
  /**
   * Get attack roll modifiers for an attacker based on their conditions
   * Returns sources of advantage and disadvantage on the attacker's rolls
   */
  static async getAttackerModifiers(attackerId: string, userId?: string): Promise<{
    hasAdvantage: boolean;
    hasDisadvantage: boolean;
    reasons: string[];
  }> {
    const effects = await ConditionsService.getMechanicalEffects(attackerId, userId);
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
    const effects = await ConditionsService.getMechanicalEffects(targetId, userId);
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
    const effects = await ConditionsService.getMechanicalEffects(participantId, userId);
    return ConditionMechanics.calculateSaveModifiers(effects, saveAbility);
  }

  /**
   * Get ability check modifiers for a participant
   */
  static async getAbilityCheckModifiers(participantId: string, userId?: string): Promise<{
    hasDisadvantage: boolean;
    reasons: string[];
  }> {
    const effects = await ConditionsService.getMechanicalEffects(participantId, userId);
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
    const mechanicalEffects = effects || await ConditionsService.getMechanicalEffects(participantId, userId);
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
    const mechanicalEffects = effects || await ConditionsService.getMechanicalEffects(participantId, userId);
    return ConditionMechanics.calculateSpeedModifiers(mechanicalEffects);
  }
}
