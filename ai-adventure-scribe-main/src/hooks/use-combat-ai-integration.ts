/**
 * Combat AI Integration Hook
 *
 * Bridges combat system with AI agents for seamless D&D experience.
 * Handles combat event notifications, AI responses, dice rolls, and rule validations.
 * Now includes combat detection from DM text and automatic dice roll generation.
 */

import { useCallback, useMemo } from 'react';

import type { CombatEvent, CombatAction, CombatParticipant, CombatEncounter } from '@/types/combat';
import type { ChatMessage } from '@/types/game';
import type { CombatMessageData } from '@/utils/combat/ai-narration-utils';
import type { DetectedCombatAction, PlayerCharacterLike } from '@/utils/combatDetection';

import { useCombat } from '@/contexts/CombatContext';
import { useCombatDetection } from '@/hooks/combat/use-combat-detection';
import { logger } from '@/lib/logger';
import { callEdgeFunction } from '@/utils/edgeFunctionHandler';

// Re-export types and constants for backward compatibility
export type { CombatMessageData };
export { combatActionPrompts } from '@/utils/combat/ai-narration-utils';

interface CombatAIIntegrationProps {
  sessionId?: string;
  characterId?: string;
  campaignId?: string;
}

export interface UseCombatAIIntegrationReturn {
  validateCombatAction: (
    action: Partial<CombatAction>,
    participant: CombatParticipant,
  ) => Promise<{ isValid: boolean; suggestions: string[]; errors: string[] }>;
  processCombatEvent: (event: CombatEvent) => Promise<void>;
  processDMResponse: (
    dmMessage: ChatMessage,
    playerCharacter?: PlayerCharacterLike,
  ) => Promise<{
    combatDetected: boolean;
    shouldStartCombat: boolean;
    shouldEndCombat: boolean;
    combatMessages: ChatMessage[];
  }>;
  createCombatActionRoll: (action: DetectedCombatAction) => Promise<CombatMessageData | null>;
  isInCombat: boolean;
  encounter: CombatEncounter | null;
}

export const useCombatAIIntegration = ({
  sessionId,
  characterId: _characterId,
  campaignId: _campaignId,
}: CombatAIIntegrationProps): UseCombatAIIntegrationReturn => {
  const combatContext = useCombat();

  if (!combatContext) {
    throw new Error('useCombatAIIntegration must be used within CombatProvider');
  }

  const { state, startCombat, endCombat, addParticipant: _addParticipant } = combatContext;

  const combatState = useMemo(
    () => ({
      isInCombat: state.isInCombat,
      activeEncounter: state.activeEncounter,
    }),
    [state.isInCombat, state.activeEncounter],
  );

  // Delegate combat detection logic to specialized hook
  const { processDMResponse, createCombatActionRoll } = useCombatDetection({
    sessionId,
    state: combatState,
    startCombat,
    endCombat,
  });

  // Kept as a compatibility no-op while the retired combat-event narration path is removed.
  const processCombatEvent = useCallback(async (_event: CombatEvent) => undefined, []);

  // Validate combat action with the still-supported rules compatibility call.
  const validateCombatAction = useCallback(
    async (
      action: Partial<CombatAction>,
      participant: CombatParticipant,
    ): Promise<{ isValid: boolean; suggestions: string[]; errors: string[] }> => {
      try {
        const validation = await callEdgeFunction('rules-interpreter-execute', {
          task: {
            id: `combat_validation_${Date.now()}`,
            description: `Validate ${action.actionType} action for ${participant.name}`,
            expectedOutput: 'Combat action validation result',
            context: {
              ruleType: 'combat',
              data: {
                action,
                participant,
                encounter: state.activeEncounter,
              },
            },
          },
          agentContext: {
            role: 'Rules Interpreter',
            goal: 'Validate combat action according to D&D 5e rules',
            backstory: 'Expert in D&D 5e combat mechanics',
          },
        });

        return {
          isValid: validation?.isValid ?? true,
          suggestions: validation?.suggestions ?? [],
          errors: validation?.errors ?? [],
        };
      } catch (error) {
        logger.error('Error validating combat action:', error);
        return { isValid: true, suggestions: [], errors: [] };
      }
    },
    [state.activeEncounter],
  );

  return {
    validateCombatAction,
    processCombatEvent,
    processDMResponse,
    createCombatActionRoll,
    isInCombat: state.isInCombat,
    encounter: state.activeEncounter,
  };
};
