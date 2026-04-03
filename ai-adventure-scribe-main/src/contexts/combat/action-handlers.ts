/**
 * Combat Action Handlers
 * Handles specific action types in combat (spell casting, divine smite, rage, etc.)
 * Extracted from CombatContext.tsx for modularity
 */

import type { CombatParticipant, CombatAction as CombatActionType } from '@/types/combat';
import type { SpellSlotLevel } from '@/utils/spell-management';

import logger from '@/lib/logger';
import { activateRage, deactivateRage } from '@/utils/classFeatures';
import { castSpell } from '@/utils/spell-management';
import { processShortRestCombat, processLongRestCombat } from '@/utils/restMechanics';
import { attemptHide, applyHiddenCondition, removeHiddenCondition } from '@/utils/stealthUtils';

/**
 * Result of handling an action
 */
export interface ActionHandlerResult {
  /** Updates to apply to the participant */
  participantUpdates: Partial<CombatParticipant>;
  /** Updates to apply to the action */
  actionUpdates: Partial<CombatActionType>;
  /** Whether the action was successful */
  success: boolean;
  /** Error message if action failed */
  errorMessage?: string;
}

/**
 * Handle spell casting action
 */
export function handleSpellCast(
  action: Partial<CombatActionType>,
  participant: CombatParticipant,
): ActionHandlerResult {
  try {
    const spellLevel = (action.spellLevel as SpellSlotLevel) || 1;
    const spellName = action.spellName || 'Unknown Spell';
    const { updatedParticipant, updatedAction } = castSpell(
      action,
      participant,
      spellName,
      spellLevel,
    );

    return {
      participantUpdates: {
        spellSlots: updatedParticipant.spellSlots,
        activeConcentration: updatedParticipant.activeConcentration,
        actionTaken: true,
      },
      actionUpdates: updatedAction,
      success: true,
    };
  } catch (error) {
    logger.error('Spell casting failed:', error);
    return {
      participantUpdates: { actionTaken: true },
      actionUpdates: {
        description: `${action.description || 'Spell'} (Failed: ${(error as Error).message})`,
      },
      success: false,
      errorMessage: (error as Error).message,
    };
  }
}

/**
 * Handle Divine Smite action (Paladin)
 */
export function handleDivineSmite(
  action: Partial<CombatActionType>,
  participant: CombatParticipant,
): ActionHandlerResult {
  try {
    // Validate paladin class
    if (participant.characterClass !== 'paladin' || !participant.spellSlots) {
      throw new Error('Only paladins can use Divine Smite');
    }

    // Find the lowest available spell slot (at least 1st level)
    let spellSlotLevel: SpellSlotLevel | null = null;
    for (let i = 1; i <= 5; i++) {
      if (participant.spellSlots[i as SpellSlotLevel]?.current > 0) {
        spellSlotLevel = i as SpellSlotLevel;
        break;
      }
    }

    if (!spellSlotLevel) {
      throw new Error('No available spell slots for Divine Smite');
    }

    // Deduct the spell slot
    const updatedSlots = { ...participant.spellSlots };
    updatedSlots[spellSlotLevel] = {
      ...updatedSlots[spellSlotLevel],
      current: updatedSlots[spellSlotLevel].current - 1,
    };

    return {
      participantUpdates: {
        spellSlots: updatedSlots,
        actionTaken: true,
      },
      actionUpdates: {
        description: `${participant.name} uses Divine Smite with a level ${spellSlotLevel} spell slot`,
      },
      success: true,
    };
  } catch (error) {
    logger.error('Divine Smite failed:', error);
    return {
      participantUpdates: { actionTaken: true },
      actionUpdates: {
        description: `${action.description || 'Divine Smite'} (Failed: ${(error as Error).message})`,
      },
      success: false,
      errorMessage: (error as Error).message,
    };
  }
}

/**
 * Handle Rage activation (Barbarian)
 */
export function handleRageActivation(
  action: Partial<CombatActionType>,
  participant: CombatParticipant,
): ActionHandlerResult {
  try {
    if (!participant.resources) {
      throw new Error('Participant has no resources');
    }

    const { updatedParticipant, updatedResources, rageDamageBonus } = activateRage(
      participant,
      participant.resources,
    );

    return {
      participantUpdates: {
        ...updatedParticipant,
        resources: updatedResources,
        actionTaken: true,
      },
      actionUpdates: {
        description: `${participant.name} enters a rage, gaining resistance to bludgeoning, piercing, and slashing damage and +${rageDamageBonus} damage to melee attacks`,
      },
      success: true,
    };
  } catch (error) {
    logger.error('Rage activation failed:', error);
    return {
      participantUpdates: { actionTaken: true },
      actionUpdates: {
        description: `${action.description || 'Rage'} (Failed: ${(error as Error).message})`,
      },
      success: false,
      errorMessage: (error as Error).message,
    };
  }
}

/**
 * Handle Rage deactivation
 */
export function handleRageDeactivation(participant: CombatParticipant): ActionHandlerResult {
  try {
    const updatedParticipant = deactivateRage(participant);

    return {
      participantUpdates: {
        ...updatedParticipant,
        actionTaken: true,
      },
      actionUpdates: {
        description: `${participant.name} stops raging`,
      },
      success: true,
    };
  } catch (error) {
    logger.error('Rage deactivation failed:', error);
    return {
      participantUpdates: { actionTaken: true },
      actionUpdates: {
        description: `End rage (Failed: ${(error as Error).message})`,
      },
      success: false,
      errorMessage: (error as Error).message,
    };
  }
}

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
