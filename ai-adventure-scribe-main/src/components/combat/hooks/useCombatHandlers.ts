/**
 * Combat Interface Handlers Hook
 * Extracts combat action handlers from CombatInterface component
 * for better modularity and testability
 */

import { useCallback } from 'react';

import { useCombatAttackHandlers } from './useCombatAttackHandlers';
import { useCombatVitalityHandlers } from './useCombatVitalityHandlers';

import type {
  ActionType,
  CombatEncounter,
  ReactionOpportunity,
} from '@/types/combat';

import { useCombat } from '@/contexts/CombatContext';
import logger from '@/lib/logger';
import { canUseClassFeature } from '@/utils/classFeatures';
import { rollDice } from '@/utils/diceUtils';
import { canUseRacialTrait } from '@/utils/racialTraits';
import { processReactionResponse } from '@/utils/reactionSystem';

interface UseCombatHandlersProps {
  activeEncounter: CombatEncounter | null;
  selectedEnemy: string | null;
  validateCombatAction: (action: any, participant: any) => Promise<any>;
  setActionValidation: (validation: any) => void;
  setReactionOpportunities: React.Dispatch<React.SetStateAction<ReactionOpportunity[]>>;
}

export function useCombatHandlers({
  activeEncounter,
  selectedEnemy,
  validateCombatAction,
  setActionValidation,
  setReactionOpportunities,
}: UseCombatHandlersProps): {
  handleCombatAction: (
    actionType: ActionType,
    participantId: string,
    targetId?: string,
    additionalData?: any,
  ) => Promise<void>;
  handleEnemyAttack: (attack: any) => Promise<void>;
  handleEnhancedAttack: (
    participantId: string,
    targetId?: string,
    actionType?: ActionType,
    hasAdvantage?: boolean,
    hasDisadvantage?: boolean,
    divineSmiteSlotLevel?: number,
  ) => Promise<void>;
  handleRacialTraitUse: (participantId: string, traitName: string) => Promise<void>;
  handleClassFeature: (participantId: string, featureName: string) => Promise<void>;
  handleReactionOpportunity: (
    opportunity: ReactionOpportunity,
    selectedReaction: ActionType,
  ) => Promise<void>;
  handleDeathSave: (participantId: string) => Promise<void>;
  handleConcentrationSave: (participantId: string, dc: number) => Promise<void>;
  handleTwoWeaponAttack: (participantId: string, targetId?: string) => Promise<void>;
  handleApplyDamage: (
    participantId: string,
    damageAmount: number,
    damageType: string,
  ) => Promise<void>;
  handleHealing: (participantId: string, healingAmount: number) => Promise<void>;
} {
  const { takeAction, updateParticipant } = useCombat();

  const {
    handleDeathSave,
    handleConcentrationSave,
    handleApplyDamage,
    handleHealing,
  } = useCombatVitalityHandlers({ activeEncounter });

  /**
   * Validate and execute combat action
   */
  const handleCombatAction = useCallback(
    async (
      actionType: ActionType,
      participantId: string,
      targetId?: string,
      additionalData?: any,
    ) => {
      if (!activeEncounter) return;

      const participant = activeEncounter.participants.find((p) => p.id === participantId);
      if (!participant) return;

      const action = {
        participantId,
        targetParticipantId: targetId,
        actionType,
        description: `${participant.name} attempts to ${actionType}`,
        ...additionalData,
      };

      try {
        const validation = await validateCombatAction(action, participant);
        setActionValidation(validation);

        if (!validation.isValid) {
          logger.warn('Invalid combat action:', validation.errors);
          return;
        }

        await takeAction(action);
        setActionValidation(null);
      } catch (error) {
        logger.error('Error validating combat action:', error);
        await takeAction(action);
      }
    },
    [activeEncounter, takeAction, validateCombatAction, setActionValidation],
  );

  const {
    handleEnemyAttack,
    handleEnhancedAttack,
    handleTwoWeaponAttack,
  } = useCombatAttackHandlers({
    activeEncounter,
    selectedEnemy,
    handleCombatAction,
  });

  /**
   * Handle racial trait usage
   */
  const handleRacialTraitUse = useCallback(
    async (participantId: string, traitName: string) => {
      if (!activeEncounter) return;

      const participant = activeEncounter.participants.find((p) => p.id === participantId);
      if (!participant || !participant.racialTraits) return;

      const trait = participant.racialTraits.find((t) => t.name === traitName);
      if (!trait || !canUseRacialTrait(trait)) return;

      let description = '';
      switch (trait.name) {
        case 'breath_weapon':
          description = `${participant.name} uses their breath weapon`;
          break;
        case 'relentless_endurance':
          description = `${participant.name} drops to 1 hit point instead of 0`;
          break;
        default:
          description = `${participant.name} uses ${trait.name}`;
      }

      await handleCombatAction('bonus_action', participantId, undefined, {
        participantId,
        actionType: 'use_racial_trait' as ActionType,
        description,
        traitUsed: trait.name,
      });
    },
    [activeEncounter, handleCombatAction],
  );

  /**
   * Handle class feature usage
   */
  const handleClassFeature = useCallback(
    async (participantId: string, featureName: string) => {
      if (!activeEncounter) return;

      const participant = activeEncounter.participants.find((p) => p.id === participantId);
      if (!participant || !participant.classFeatures || !participant.resources) return;

      const feature = participant.classFeatures.find((f) => f.name === featureName);
      if (!feature || !canUseClassFeature(feature, participant.resources)) return;

      let description = '';
      let actionType: ActionType = 'use_class_feature' as ActionType;

      switch (feature.name) {
        case 'rage':
          if (participant.isRaging) {
            description = `${participant.name} stops raging`;
            actionType = 'end_rage' as ActionType;
          } else {
            description = `${participant.name} enters a rage`;
          }
          break;
        case 'action_surge':
          description = `${participant.name} uses Action Surge for an additional action`;
          actionType = 'action_surge' as ActionType;
          break;
        case 'second_wind': {
          const healing = rollDice(10, 1, participant.level || 1);
          description = `${participant.name} uses Second Wind to heal ${healing.total} hit points`;
          actionType = 'second_wind' as ActionType;
          break;
        }
        default:
          description = `${participant.name} uses ${feature.name}`;
      }

      await handleCombatAction(actionType, participantId, undefined, {
        participantId,
        actionType,
        description,
        featureUsed: feature.name,
      });
    },
    [activeEncounter, handleCombatAction],
  );

  /**
   * Handle reaction opportunity response
   */
  const handleReactionOpportunity = useCallback(
    async (opportunity: ReactionOpportunity, selectedReaction: ActionType) => {
      if (!activeEncounter) return;

      try {
        const reactionAction = processReactionResponse(
          opportunity,
          selectedReaction,
          activeEncounter,
        );
        await takeAction(reactionAction);

        const participant = activeEncounter.participants.find(
          (p) => p.id === opportunity.participantId,
        );
        if (participant) {
          updateParticipant(opportunity.participantId, { reactionTaken: true });
        }

        setReactionOpportunities((prev) => prev.filter((opp) => opp.id !== opportunity.id));
      } catch (error) {
        logger.error('Error processing reaction:', error);
      }
    },
    [activeEncounter, takeAction, updateParticipant, setReactionOpportunities],
  );

  return {
    handleCombatAction,
    handleEnemyAttack,
    handleEnhancedAttack,
    handleRacialTraitUse,
    handleClassFeature,
    handleReactionOpportunity,
    handleDeathSave,
    handleConcentrationSave,
    handleTwoWeaponAttack,
    handleApplyDamage,
    handleHealing,
  };
}
