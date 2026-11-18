import { useState, useCallback } from 'react';

import type {
  ActionType,
  ReactionOpportunity,
  CombatEncounter,
  DamageType,
  MonsterAttack,
} from '@/types/combat';

import logger from '@/lib/logger';
import {
  executeAuthoritativeCombatIntent,
  type ClientCombatIntent,
} from '@/services/combat/combat-action-executor';
import { userDataApi } from '@/services/user-data-api';

/**
 * The server intent for a player action that has one (#621 B2b). The server rolls the check and
 * applies its result. Returns null for an action with no server intent.
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
  /** Re-reads the encounter after a server HP write, so the tracker shows the new HP (#621). */
  refreshCombatState?: (signal?: AbortSignal) => Promise<unknown>;
  nextTurn: () => Promise<void>;
  selectedEnemy: string | null;
}

/**
 * Hook to manage combat action handlers, extracted from useCombatActions.
 * Every player action here goes to the server intent it names (#621 B2b, B2b step 2).
 */
export const useCombatActionHandlers = ({
  activeEncounter,
  nextTurn,
  selectedEnemy,
  refreshCombatState,
}: UseCombatActionHandlersProps) => {
  const [actionValidation, setActionValidation] = useState<{
    isValid: boolean;
    suggestions: string[];
    errors: string[];
  } | null>(null);
  const [reactionOpportunities, setReactionOpportunities] = useState<ReactionOpportunity[]>([]);

  // Dash, dodge, hide, and grapple or shove with a target go to the server. The server rolls the
  // check and applies the result. Any other action type has no server intent and does nothing.
  const handleCombatAction = useCallback(
    async (actionType: ActionType, participantId: string, targetId?: string) => {
      if (!activeEncounter) {
        return;
      }

      const participant = activeEncounter.participants.find((p) => p.id === participantId);
      if (!participant) {
        return;
      }

      const serverIntent = serverIntentForAction(actionType, participantId, targetId);
      if (!serverIntent) {
        return;
      }
      await executeAuthoritativeCombatIntent(
        activeEncounter.id,
        serverIntent,
        'player',
        undefined,
        'action_bar',
      );
    },
    [activeEncounter],
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
    handleApplyDamage,
    handleHealing,
  };
};
