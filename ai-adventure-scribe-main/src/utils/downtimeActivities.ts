/**
 * Downtime Activity Utilities for D&D 5e
 *
 * Functions for handling downtime activities, rolls, and outcomes
 */

import { commonDowntimeActivities } from './downtimeCommonActivities';

import type { Character } from '@/types/character';
import type {
  DowntimeActivity,
  DowntimeOutcome,
  DowntimeActivityType,
  DowntimeResult,
} from '@/types/downtimeActivities';

import { rollDice } from '@/utils/diceUtils';

export { commonDowntimeActivities };

/**
 * Check if a character meets the prerequisites for a downtime activity
 */
export function checkDowntimePrerequisites(
  character: Character,
  activity: DowntimeActivity,
): { canPerform: boolean; reason?: string } {
  // Check level requirement
  if (activity.levelRequirement && character.level && character.level < activity.levelRequirement) {
    return {
      canPerform: false,
      reason: `Requires level ${activity.levelRequirement}`,
    };
  }

  // Check class requirement
  if (activity.classRequirement && character.class?.name !== activity.classRequirement) {
    return {
      canPerform: false,
      reason: `Requires ${activity.classRequirement} class`,
    };
  }

  // Check gold cost
  if (
    activity.goldCost !== undefined &&
    character.gold !== undefined &&
    character.gold < activity.goldCost
  ) {
    return {
      canPerform: false,
      reason: `Requires ${activity.goldCost} gold`,
    };
  }

  // Check tool requirements
  if (activity.toolRequirements && activity.toolRequirements.length > 0) {
    const hasTools = activity.toolRequirements.every((tool) =>
      character.inventory?.some(
        (item) => item.itemId.toLowerCase().includes(tool.toLowerCase()) && item.equipped,
      ),
    );

    if (!hasTools) {
      return {
        canPerform: false,
        reason: `Requires tools: ${activity.toolRequirements.join(', ')}`,
      };
    }
  }

  // Check skill requirements
  if (activity.skillRequirements && activity.skillRequirements.length > 0) {
    const hasSkills = activity.skillRequirements.every((skill) =>
      character.skillProficiencies?.includes(skill),
    );

    if (!hasSkills) {
      return {
        canPerform: false,
        reason: `Requires skills: ${activity.skillRequirements.join(', ')}`,
      };
    }
  }

  return { canPerform: true };
}

/**
 * Perform a downtime activity and calculate the outcome
 */
export function performDowntimeActivity(
  character: Character,
  activity: DowntimeActivity,
): DowntimeResult {
  // Check prerequisites first
  const prereqCheck = checkDowntimePrerequisites(character, activity);
  if (!prereqCheck.canPerform) {
    return {
      success: false,
      activityCompleted: false,
      message: `Cannot perform activity: ${prereqCheck.reason}`,
      goldSpent: 0,
      materialsUsed: 0,
      daysSpent: 0,
    };
  }

  // Spend resources
  const updatedCharacter = { ...character };

  // Deduct gold
  if (activity.goldCost !== undefined && updatedCharacter.gold !== undefined) {
    updatedCharacter.gold -= activity.goldCost;
  }

  // Deduct materials
  if (activity.materialCost !== undefined && updatedCharacter.gold !== undefined) {
    // Using gold field for materials as well
    updatedCharacter.gold -= activity.materialCost;
  }

  // Deduct days
  // In a real implementation, we would track days in the character data

  // If no success DC, automatically succeed
  if (!activity.successDC) {
    return {
      success: true,
      activityCompleted: true,
      message: `Successfully completed ${activity.name}`,
      goldSpent: activity.goldCost || 0,
      materialsUsed: activity.materialCost || 0,
      daysSpent: activity.daysRequired,
      outcome: activity.outcomes.find((outcome) => outcome.type === 'success'),
    };
  }

  // Roll for success
  const abilityModifier = getRelevantAbilityModifier(character, activity.type);
  const rollResult = rollDice(20, 1, abilityModifier);
  const success = rollResult.total >= activity.successDC;

  // Find appropriate outcome
  let outcome: DowntimeOutcome | undefined;

  if (success) {
    outcome = activity.outcomes.find((outcome) => outcome.type === 'success');
  } else {
    // Find failure outcome
    outcome = activity.outcomes.find((outcome) => outcome.type === 'failure');

    // If no specific failure outcome, use generic failure
    if (!outcome) {
      outcome = {
        type: 'failure',
        description: 'The activity fails without significant consequence.',
        goldRecovery: 0,
        experienceGained: 0,
      };
    }
  }

  // Apply outcome effects
  if (outcome) {
    // Add experience if specified
    if (outcome.experienceGained !== undefined && updatedCharacter.experience !== undefined) {
      updatedCharacter.experience += outcome.experienceGained;
    }

    // Recover some gold on failure if specified
    if (outcome.goldRecovery !== undefined && updatedCharacter.gold !== undefined) {
      updatedCharacter.gold += outcome.goldRecovery;
    }

    // Add items if specified
    if (outcome.itemsGained && updatedCharacter.inventory) {
      updatedCharacter.inventory = [...updatedCharacter.inventory, ...outcome.itemsGained];
    }
  }

  return {
    success,
    activityCompleted: true,
    message: success
      ? `Successfully completed ${activity.name}`
      : `Failed to complete ${activity.name}`,
    goldSpent: activity.goldCost || 0,
    materialsUsed: activity.materialCost || 0,
    daysSpent: activity.daysRequired,
    outcome,
    rollResult: rollResult.total,
    dc: activity.successDC,
  };
}

/**
 * Get the relevant ability modifier for a downtime activity type
 */
function getRelevantAbilityModifier(
  character: Character,
  activityType: DowntimeActivityType,
): number {
  if (!character.abilityScores) return 0;

  switch (activityType) {
    case 'crafting':
      return character.abilityScores.intelligence?.modifier || 0;
    case 'training':
      return character.abilityScores.intelligence?.modifier || 0;
    case 'research':
      return character.abilityScores.intelligence?.modifier || 0;
    case 'crime':
      return character.abilityScores.dexterity?.modifier || 0;
    case 'gambling':
      return character.abilityScores.charisma?.modifier || 0;
    case 'carousing':
      return character.abilityScores.charisma?.modifier || 0;
    case 'working':
      return Math.max(
        character.abilityScores.strength?.modifier || 0,
        character.abilityScores.dexterity?.modifier || 0,
      );
    default:
      return 0;
  }
}

/**
 * Calculate the cost of a downtime activity in gold pieces
 */
export function calculateDowntimeCost(activity: DowntimeActivity): number {
  return (activity.goldCost || 0) + (activity.materialCost || 0);
}

/**
 * Check if a character can afford a downtime activity
 */
export function canAffordDowntimeActivity(
  character: Character,
  activity: DowntimeActivity,
): boolean {
  const totalCost = calculateDowntimeCost(activity);
  return (character.gold || 0) >= totalCost;
}

/**
 * Get all available downtime activities for a character
 */
export function getAvailableDowntimeActivities(
  character: Character,
  activities: DowntimeActivity[],
): DowntimeActivity[] {
  return activities.filter(
    (activity) => checkDowntimePrerequisites(character, activity).canPerform,
  );
}

