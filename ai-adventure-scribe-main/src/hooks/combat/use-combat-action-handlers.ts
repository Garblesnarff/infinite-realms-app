import { useState, useCallback } from 'react';

import type {
  ActionType,
  ReactionOpportunity,
  CombatParticipant,
  CombatEncounter,
  CombatAction,
  DamageType,
  MonsterAttack,
} from '@/types/combat';

import logger from '@/lib/logger';
import {
  executeAuthoritativeCombatIntent,
  type ClientCombatIntent,
} from '@/services/combat/combat-action-executor';
import { userDataApi } from '@/services/user-data-api';
import { processReactionResponse } from '@/utils/reactionSystem';

/**
 * The server intent for a player action that has one (#621 B2b). The server rolls the check and
 * applies its result. Returns null for an action with no server intent, which stays on the local
 * engine: help, ready, and a grapple or shove with no target.
 */
export const serverIntentForAction = (
  actionType: ActionType,
  actorId: string,
  targetId?: string,
): ClientCombatIntent | null => {
  if (actionType === 'dash' || actionType === 'dodge') return { type: actionType, actorId };
  if (actionType === 'hide') return { type: 'check', actorId, checkKind: 'hide' };
  if ((actionType === 'grapple' || actionType === 'shove') && targetId) {
    return { type: 'check', actorId, targetId, checkKind: actionType };
  }
  return null;
};

interface UseCombatActionHandlersProps {
  activeEncounter: CombatEncounter | null;
  takeAction: (action: Partial<CombatAction>) => Promise<void>;
  /** Re-reads the encounter after a server HP write, so the tracker shows the new HP (#621). */
  refreshCombatState?: (signal?: AbortSignal) => Promise<unknown>;
  updateParticipant: (participantId: string, updates: Partial<CombatParticipant>) => Promise<void>;
  nextTurn: () => Promise<void>;
  validateCombatAction: (
    action: Partial<CombatAction>,
    participant: CombatParticipant,
  ) => Promise<{ isValid: boolean; suggestions: string[]; errors: string[] }>;
  selectedEnemy: string | null;
}

/**
 * Hook to manage combat action handlers, extracted from useCombatActions.
 * Handles the execution and validation of various combat actions.
 */
export const useCombatActionHandlers = ({
  activeEncounter,
  takeAction,
  updateParticipant,
  nextTurn,
  validateCombatAction,
  selectedEnemy,
  refreshCombatState,
}: UseCombatActionHandlersProps) => {
  const [actionValidation, setActionValidation] = useState<{
    isValid: boolean;
    suggestions: string[];
    errors: string[];
  } | null>(null);
  const [reactionOpportunities, setReactionOpportunities] = useState<ReactionOpportunity[]>([]);

  // Validate and execute combat action
  const handleCombatAction = useCallback(
    async (
      actionType: ActionType,
      participantId: string,
      targetId?: string,
      // Genuinely heterogeneous per-actionType payload, spread (...additionalData)
      // into the action object below - see the matching note in use-combat-mechanics.ts.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      additionalData?: any,
    ) => {
      if (!activeEncounter) {
        return;
      }

      const participant = activeEncounter.participants.find((p) => p.id === participantId);
      if (!participant) {
        return;
      }

      // #621 B2b: dash, dodge, hide, grapple and shove go to the server. The server rolls the
      // check and applies the grapple or prone condition, so the browser rolls no dice here.
      const serverIntent = serverIntentForAction(actionType, participantId, targetId);
      if (serverIntent) {
        await executeAuthoritativeCombatIntent(
          activeEncounter.id,
          serverIntent,
          'player',
          undefined,
          'action_bar',
        );
        return;
      }

      // Create action for validation
      const action: Partial<CombatAction> = {
        participantId,
        targetParticipantId: targetId,
        actionType,
        description: `${participant.name} attempts to ${actionType}`,
        ...additionalData,
      };

      // Validate action with AI rules interpreter
      try {
        const validation = await validateCombatAction(action, participant);
        setActionValidation(validation);

        if (!validation.isValid) {
          // Show validation errors to user
          logger.warn('Invalid combat action:', validation.errors);
          return;
        }

        // Execute valid action
        await takeAction(action);
        setActionValidation(null);
      } catch (error) {
        logger.error('Error validating combat action:', error);
        // Proceed with action if validation fails
        await takeAction(action);
      }
    },
    [activeEncounter, takeAction, validateCombatAction],
  );

  // Handle enemy attack. The server rolls the enemy's attack and its damage (#621 B2b). The
  // attack picked in the menu is not sent: the server resolves the enemy's own attack.
  const handleEnemyAttack = useCallback(
    async (_attack: MonsterAttack) => {
      if (!selectedEnemy || !activeEncounter) {
        return;
      }

      const enemy = activeEncounter.participants.find((p) => p.id === selectedEnemy);
      if (!enemy) {
        return;
      }

      const targetId = activeEncounter.currentTurnParticipantId;
      if (targetId) {
        await executeAuthoritativeCombatIntent(
          activeEncounter.id,
          { type: 'attack', actorId: selectedEnemy, targetId },
          'dm',
          Date.now(),
          'typed',
        );
      }

      // Auto-advance turn after enemy action
      setTimeout(() => {
        nextTurn();
      }, 1500);
    },
    [selectedEnemy, activeEncounter, nextTurn],
  );

  // Handle reaction opportunities
  const handleReactionOpportunity = useCallback(
    async (opportunity: ReactionOpportunity, selectedReaction: ActionType) => {
      if (!activeEncounter) {
        return;
      }

      try {
        const reactionAction = processReactionResponse(
          opportunity,
          selectedReaction,
          activeEncounter,
        );
        await takeAction(reactionAction);

        // Mark participant as having used their reaction
        const participant = activeEncounter.participants.find(
          (p) => p.id === opportunity.participantId,
        );
        if (participant) {
          updateParticipant(opportunity.participantId, { reactionTaken: true });
        }

        // Remove the opportunity after use
        setReactionOpportunities((prev) => prev.filter((opp) => opp.id !== opportunity.id));
      } catch (error) {
        logger.error('Error processing reaction:', error);
      }
    },
    [activeEncounter, takeAction, updateParticipant],
  );

  // Handle applying direct damage. The server applies it (#621 Part B2a). Only player characters
  // have a route; a participant without a characterId gets no write and no HP control.
  const handleApplyDamage = useCallback(
    async (participantId: string, damageAmount: number, damageType: string) => {
      const characterId = activeEncounter?.participants.find(
        (p) => p.id === participantId,
      )?.characterId;
      if (!characterId) {
        return;
      }
      try {
        await userDataApi.applyCharacterDamage(characterId, damageAmount, damageType as DamageType);
        await refreshCombatState?.();
      } catch (error) {
        logger.error('Failed to apply damage through the server:', error);
      }
    },
    [activeEncounter, refreshCombatState],
  );

  // Handle healing. The server adds the amount and clamps to max HP (#214, #621 Part B2a).
  const handleHealing = useCallback(
    async (participantId: string, healingAmount: number) => {
      const characterId = activeEncounter?.participants.find(
        (p) => p.id === participantId,
      )?.characterId;
      if (!characterId) {
        return;
      }
      try {
        await userDataApi.applyCharacterHealing(characterId, healingAmount);
        await refreshCombatState?.();
      } catch (error) {
        logger.error('Failed to heal through the server:', error);
      }
    },
    [activeEncounter, refreshCombatState],
  );

  return {
    actionValidation,
    setActionValidation,
    reactionOpportunities,
    setReactionOpportunities,
    handleCombatAction,
    handleEnemyAttack,
    handleReactionOpportunity,
    handleApplyDamage,
    handleHealing,
  };
};
