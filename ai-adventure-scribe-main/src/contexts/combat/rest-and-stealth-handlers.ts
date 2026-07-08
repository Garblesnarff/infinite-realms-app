/**
 * Combat handlers for short/long rests and the Hide action.
 */

import type { ActionHandlerResult } from './action-handlers';
import type { CombatParticipant } from '@/types/combat';

import logger from '@/lib/logger';
import { applyRestResultToCombatParticipant, restApi } from '@/services/rest-api';
import { attemptHide, applyHiddenCondition, removeHiddenCondition } from '@/utils/stealthUtils';

/**
 * Handle Short Rest action
 */
export function handleShortRest(
  participant: CombatParticipant,
  hitDiceToRoll: number = 1,
): Promise<ActionHandlerResult> {
  return handleRest(participant, 'short', hitDiceToRoll);
}

async function handleRest(
  participant: CombatParticipant,
  restType: 'short' | 'long',
  hitDiceToRoll: number = 0,
): Promise<ActionHandlerResult> {
  if (!participant.characterId) {
    return {
      participantUpdates: { actionTaken: true },
      actionUpdates: {
        description: `${participant.name} cannot take a ${restType} rest without a linked character`,
      },
      success: false,
      errorMessage: 'Combat participant is not linked to a character',
    };
  }

  try {
    const result =
      restType === 'short'
        ? await restApi.shortRest(participant.characterId, hitDiceToRoll)
        : await restApi.longRest(participant.characterId);
    const updatedParticipant = applyRestResultToCombatParticipant(participant, result);

    return {
      participantUpdates: {
        ...updatedParticipant,
        actionTaken: true,
      },
      actionUpdates: {
        description: `${participant.name} takes a ${restType} rest`,
      },
      success: true,
    };
  } catch (error) {
    logger.error(`Combat ${restType} rest failed:`, error);
    return {
      participantUpdates: { actionTaken: true },
      actionUpdates: {
        description: `${participant.name} ${restType} rest failed: ${(error as Error).message}`,
      },
      success: false,
      errorMessage: (error as Error).message,
    };
  }
}

/**
 * Handle Long Rest action
 */
export function handleLongRest(participant: CombatParticipant): Promise<ActionHandlerResult> {
  return handleRest(participant, 'long');
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
