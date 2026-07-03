/**
 * Combat handlers for short/long rests and the Hide action.
 */

import type { ActionHandlerResult } from './action-handlers';
import type { CombatParticipant } from '@/types/combat';

import logger from '@/lib/logger';
import { processShortRestCombat, processLongRestCombat } from '@/utils/restMechanics';
import { attemptHide, applyHiddenCondition, removeHiddenCondition } from '@/utils/stealthUtils';

/**
 * Handle Short Rest action
 */
export function handleShortRest(
  participant: CombatParticipant,
  hitDiceToRoll: number = 1,
): ActionHandlerResult {
  const updatedParticipant = processShortRestCombat(participant, hitDiceToRoll);

  return {
    participantUpdates: {
      ...updatedParticipant,
      actionTaken: true,
    },
    actionUpdates: {
      description: `${participant.name} takes a short rest`,
    },
    success: true,
  };
}

/**
 * Handle Long Rest action
 */
export function handleLongRest(participant: CombatParticipant): ActionHandlerResult {
  const updatedParticipant = processLongRestCombat(participant);

  return {
    participantUpdates: {
      ...updatedParticipant,
      actionTaken: true,
    },
    actionUpdates: {
      description: `${participant.name} takes a long rest`,
    },
    success: true,
  };
}

/**
 * Handle Hide action
 */
export function handleHideAction(participant: CombatParticipant): ActionHandlerResult {
  try {
    const hideResult = attemptHide(participant);

    const updatedParticipant = hideResult.success
      ? applyHiddenCondition(participant)
      : removeHiddenCondition(participant);

    return {
      participantUpdates: {
        ...updatedParticipant,
        actionTaken: true,
      },
      actionUpdates: {
        description: hideResult.description,
        attackRoll: hideResult.roll,
      },
      success: hideResult.success,
    };
  } catch (error) {
    logger.error('Hide action failed:', error);
    return {
      participantUpdates: { actionTaken: true },
      actionUpdates: {
        description: `Hide (Failed: ${(error as Error).message})`,
      },
      success: false,
      errorMessage: (error as Error).message,
    };
  }
}
