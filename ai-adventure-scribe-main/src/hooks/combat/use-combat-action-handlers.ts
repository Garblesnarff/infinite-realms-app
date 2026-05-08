import { useState, useCallback } from 'react';

import type {
  ActionType,
  ReactionOpportunity,
  CombatParticipant,
  CombatEncounter,
  CombatAction,
} from '@/types/combat';

import logger from '@/lib/logger';
import { processReactionResponse } from '@/utils/reactionSystem';
import { checkConcentration } from '@/utils/spell-management';

interface UseCombatActionHandlersProps {
  activeEncounter: CombatEncounter | null;
  takeAction: (action: Partial<CombatAction>) => Promise<void>;
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

  // Handle enemy attack with AI integration
  const handleEnemyAttack = useCallback(
    async (attack: any) => {
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
          activeEncounter as any,
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

  // Handle applying direct damage
  const handleApplyDamage = useCallback(
    async (participantId: string, damageAmount: number, damageType: string) => {
      if (!activeEncounter) {
        return;
      }
      const participant = activeEncounter.participants.find((p) => p.id === participantId);
      if (!participant) {
        return;
      }

      const newHP = Math.max(0, (participant.currentHitPoints || 0) - damageAmount);
      const isUnconscious = newHP <= 0;

      let concentrationLost = false;
      if (participant.activeConcentration && damageAmount > 0) {
        concentrationLost = !checkConcentration(participant as any, damageAmount);
      }

      const updatedProps: Partial<CombatParticipant> = {
        currentHitPoints: newHP,
        isUnconscious,
      };

      if (concentrationLost) {
        updatedProps.activeConcentration = null;
      }

      if (isUnconscious && (participant.currentHitPoints || 0) > 0) {
        updatedProps.isStable = false;
        updatedProps.deathSaves = { successes: 0, failures: 0 };
      }

      updateParticipant(participantId, updatedProps);

      const action: Partial<CombatAction> = {
        participantId,
        actionType: 'damage_dealt' as ActionType,
        description: `${participant.name} takes ${damageAmount} ${damageType} damage.`,
        damageDealt: damageAmount,
        damageType: damageType as any,
        effects: {
          newHitPoints: newHP,
          unconscious: isUnconscious,
          concentrationLost,
        } as any,
      };
      await takeAction(action);
    },
    [activeEncounter, updateParticipant, takeAction],
  );

  // Handle healing
  const handleHealing = useCallback(
    async (participantId: string, healingAmount: number) => {
      if (!activeEncounter) {
        return;
      }

      const participant = activeEncounter.participants.find((p) => p.id === participantId);
      if (!participant) {
        return;
      }

      // Simple healing logic
      const maxHP = participant.maxHitPoints || 1;
      const newHP = Math.min(maxHP, (participant.currentHitPoints || 0) + healingAmount);
      const wasUnconscious = (participant.currentHitPoints || 0) <= 0;
      const revived = wasUnconscious && newHP > 0;

      // Update participant
      updateParticipant(participantId, {
        currentHitPoints: newHP,
        isUnconscious: (newHP <= 0) as any,
      } as any);

      const description = `${participant.name} heals ${healingAmount} hit points${revived ? ' and regains consciousness' : ''}`;

      const action: Partial<CombatAction> = {
        participantId,
        actionType: 'heal' as ActionType,
        description,
        healingAmount,
        effects: {
          revivedFromUnconscious: revived,
          newHitPoints: newHP,
        } as any,
      } as any;

      await takeAction(action);
    },
    [activeEncounter, updateParticipant, takeAction],
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
