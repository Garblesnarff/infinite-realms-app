/**
 * Condition Effects Utility
 *
 * This module provides centralized logic for applying D&D 5e condition effects
 * to combat participants. It handles automatic modifiers, duration tracking,
 * and save-based removal for all standard conditions.
 *
 * @author AI Assistant
 */

import { d20 } from './diceRolls';

import type { CombatParticipant, Condition, ConditionName, DiceRoll } from '@/types/combat';
import type { ConditionModifiers } from '@/utils/condition-definitions';

import { CONDITION_EFFECTS } from '@/utils/condition-definitions';

// ===========================
// Main Function: Get Condition Modifiers
// ===========================

/**
 * Gets the cumulative modifiers from all active conditions on a participant
 *
 * @param participant - The participant with conditions
 * @param rollType - Type of roll: 'attack', 'save', 'defense', 'ability_check', etc.
 * @param target - Optional target for attacks
 * @returns Combined modifiers from all conditions
 */
export function getConditionModifiers(
  participant: CombatParticipant,
  rollType: string,
  target?: CombatParticipant,
): ConditionModifiers {
  const allConditions = participant.conditions;
  const cumulativeModifiers: ConditionModifiers = {
    advantage: false,
    disadvantage: false,
    bonus: 0,
    autoFail: false,
    description: '',
  };

  const descriptions: string[] = [];

  for (const condition of allConditions) {
    if (!CONDITION_EFFECTS[condition.name as ConditionName]) continue;

    const conditionDef = CONDITION_EFFECTS[condition.name as ConditionName];
    const modifiers = conditionDef.getModifiers(participant, rollType, target);

    // Combine modifiers (advantage/disadvantage cancel each other)
    if (modifiers.advantage) cumulativeModifiers.advantage = true;
    if (modifiers.disadvantage) cumulativeModifiers.disadvantage = true;

    cumulativeModifiers.bonus += modifiers.bonus;
    if (modifiers.autoFail) cumulativeModifiers.autoFail = true;

    if (modifiers.description) {
      descriptions.push(modifiers.description);
    }
  }

  cumulativeModifiers.description = descriptions.join('; ');

  return cumulativeModifiers;
}

// ===========================
// Condition Application/Removal Functions
// ===========================

/**
 * Applies condition effects to a participant (called when condition is added)
 *
 * @param participant - Target participant
 * @param condition - Condition being applied
 * @returns Updated participant with effects applied
 */
export function applyConditionEffects(
  participant: CombatParticipant,
  condition: Condition,
): CombatParticipant {
  const conditionDef = CONDITION_EFFECTS[condition.name as ConditionName];
  if (!conditionDef?.onApply) {
    // If no specific apply logic, just return updated participant
    return {
      ...participant,
      conditions: [...participant.conditions, condition],
    };
  }

  return conditionDef.onApply(participant, condition);
}

/**
 * Removes condition effects from a participant (called when condition is removed)
 *
 * @param participant - Target participant
 * @param condition - Condition being removed
 * @returns Updated participant with effects removed
 */
export function removeConditionEffects(
  participant: CombatParticipant,
  condition: Condition,
): CombatParticipant {
  const conditionDef = CONDITION_EFFECTS[condition.name as ConditionName];
  if (!conditionDef?.onRemove) {
    // Remove condition from array
    return {
      ...participant,
      conditions: participant.conditions.filter((c) => c.name !== condition.name),
    };
  }

  return conditionDef.onRemove(participant, condition);
}

// ===========================
// Saving Throw Handling
// ===========================

/**
 * Handles saving throws for condition removal (call when condition needs save)
 *
 * @param participant - Participant making the save
 * @param condition - Condition requiring save
 * @param saveModifier - Additional modifier (e.g., from proficiency)
 * @returns {success: boolean, roll: DiceRoll}
 */
export function handleConditionSave(
  _participant: CombatParticipant,
  condition: Condition,
  saveModifier: number = 0,
): { success: boolean; roll: DiceRoll } {
  // Most conditions use Constitution saves
  const totalModifier = saveModifier; // Simplified - would normally calculate based on CON modifier
  const rollResult = d20();
  const adjustedRoll = rollResult + totalModifier;

  const dc = condition.saveDC || 10; // Default DC if not specified
  const success = adjustedRoll >= dc;

  // Construct the DiceRoll object
  const finalRoll: DiceRoll = {
    dieType: 20,
    count: 1,
    modifier: totalModifier,
    results: [rollResult],
    keptResults: [rollResult],
    total: adjustedRoll,
    advantage: false,
    disadvantage: false,
    critical: rollResult === 20,
    naturalRoll: rollResult,
  };

  return { success, roll: finalRoll };
}

// ===========================
// Exhaustion Effects (Special Case)
// ===========================

/**
 * Gets exhaustion effects for a given level (1-6)
 *
 * @param level - Exhaustion level (1-6)
 * @returns Array of effects applied
 */
export function getExhaustionEffects(level: number): string[] {
  const exhaustionEffects: Record<number, string[]> = {
    1: ['Disadvantage on ability checks'],
    2: ['Speed halved'],
    3: ['Disadvantage on attack rolls and saving throws'],
    4: ['Hit points maximum halved'],
    5: ['Speed reduced to 0'],
    6: ['Death'],
  };

  const effects: string[] = [];
  for (let i = 1; i <= level; i++) {
    effects.push(...exhaustionEffects[i]);
  }

  return effects;
}

// ===========================
// Utility Functions
// ===========================

/**
 * Gets condition description by name
 *
 * @param conditionName - Name of the condition
 * @returns Description string
 */
export function getConditionDescription(conditionName: ConditionName): string {
  return CONDITION_EFFECTS[conditionName]?.description || 'Unknown condition';
}

/**
 * Gets condition effect bullet points for UI display
 *
 * @param conditionName - Name of the condition
 * @returns Array of effect strings
 */
export function getConditionEffects(conditionName: ConditionName): string[] {
  return CONDITION_EFFECTS[conditionName]?.effect || [];
}

/**
 * Checks if a participant has a specific condition active
 *
 * @param participant - Participant to check
 * @param conditionName - Condition name to check for
 * @returns Boolean indicating presence
 */
export function hasCondition(
  participant: CombatParticipant,
  conditionName: ConditionName,
): boolean {
  return participant.conditions.some((c) => c.name === conditionName);
}

export { CONDITION_EFFECTS };
