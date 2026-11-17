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
import { userDataApi } from '@/services/user-data-api';
import { createGrappledCondition, rollGrappleCheck, rollShoveCheck } from '@/utils/grappleUtils';
import { processReactionResponse } from '@/utils/reactionSystem';

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

      // Create action for validation
      const action: Partial<CombatAction> = {
        participantId,
        targetParticipantId: targetId,
        actionType,
        description: `${participant.name} attempts to ${actionType}`,
        ...additionalData,
      };

      if ((actionType === 'grapple' || actionType === 'shove') && targetId) {
        const target = activeEncounter.participants.find((entry) => entry.id === targetId);
        if (!target) return;
        const check =
          actionType === 'grapple'
            ? rollGrappleCheck(participant, target)
            : rollShoveCheck(participant, target);
        action.attackRoll = check.roll;
        action.hit = check.success;
        action.description = `${participant.name} ${check.success ? 'succeeds' : 'fails'} to ${actionType} ${target.name} (${check.roll.total} vs ${check.opposingRoll.total})`;

        if (check.success) {
          const condition =
            actionType === 'grapple'
              ? createGrappledCondition(participantId, check.dc)
              : {
                  name: 'prone' as const,
                  description: 'The creature is prone and must stand to end this condition.',
                  duration: -1,
                  concentrationRequired: false,
                };
          await updateParticipant(targetId, {
            conditions: [
              ...target.conditions.filter((entry) => entry.name !== condition.name),
              condition,
            ],
          });
        }
      }

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
    [activeEncounter, takeAction, updateParticipant, validateCombatAction],
  );

  // Handle enemy attack with AI integration
  const handleEnemyAttack = useCallback(
    async (attack: MonsterAttack) => {
      if (!selectedEnemy || !activeEncounter) {
        return;
      }

      const enemy = activeEncounter.participants.find((p) => p.id === selectedEnemy);
      if (!enemy) {
        return;
      }

      await handleCombatAction(
        'attack',
        selectedEnemy,
        activeEncounter.currentTurnParticipantId || '',
        {
          attackRoll: {
            total: Math.floor(Math.random() * 20) + 1 + (attack.attackBonus || 0),
            rolls: [Math.floor(Math.random() * 20) + 1],
            modifier: attack.attackBonus || 0,
          },
          damageRolls: attack.damageRoll
            ? [
                {
                  total: 0, // Will be calculated
                  rolls: [],
                  modifier: 0,
                },
              ]
            : [],
          damageType: attack.damageType,
          description: `${enemy.name} uses ${attack.name}`,
        },
      );

      // Auto-advance turn after enemy action
      setTimeout(() => {
        nextTurn();
      }, 1500);
    },
    [selectedEnemy, activeEncounter, handleCombatAction, nextTurn],
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
