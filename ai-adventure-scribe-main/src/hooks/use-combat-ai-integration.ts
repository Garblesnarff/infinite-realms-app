/**
 * Combat AI Integration Hook
 *
 * Bridges combat system with AI agents for seamless D&D experience.
 * Handles combat event notifications, AI responses, dice rolls, and rule validations.
 * Now includes combat detection from DM text and automatic dice roll generation.
 */

import { useEffect, useRef, useCallback, useMemo } from 'react';

import type { CombatEvent, CombatAction, CombatParticipant, CombatEncounter } from '@/types/combat';
import type { ChatMessage } from '@/types/game';
import type { CombatMessageData } from '@/utils/combat/ai-narration-utils';
import type { DetectedCombatAction, PlayerCharacterLike } from '@/utils/combatDetection';

import { useCombat } from '@/contexts/CombatContext';
import { useCombatDetection } from '@/hooks/combat/use-combat-detection';
import { useMessages } from '@/hooks/use-messages';
import { logger } from '@/lib/logger';
import {
  shouldTriggerDMNarration,
  formatCombatEventForDM,
} from '@/utils/combat/ai-narration-utils';
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
  const { addMessage } = useMessages(sessionId);
  const lastProcessedAction = useRef<string | null>(null);
  const lastProcessedRound = useRef<number>(0);

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

  // Process combat events and trigger AI responses (legacy functionality)
  const processCombatEvent = useCallback(
    async (event: CombatEvent) => {
      if (!sessionId) return;

      try {
        // Limit DM narration to specific narrative events to balance experience and AI call frequency
        const shouldNarrate = shouldTriggerDMNarration(event, combatState.activeEncounter);

        if (shouldNarrate) {
          // Format the message for DM agent
          const eventMessage = formatCombatEventForDM(event);

          // Send combat context to DM agent via updated edge function handler
          // This will automatically use local AIService if available
          const dmResponse = await callEdgeFunction('dm-agent-execute', {
            task: {
              id: `combat_event_${Date.now()}`,
              description: eventMessage,
              expectedOutput: 'Combat narrative response',
              context: {
                messageHistory: [], // Previous messages would go here
                playerIntent: 'combat',
                playerEmotion: 'focused',
              },
            },
            agentContext: {
              role: 'Dungeon Master',
              goal: 'Narrate combat events dramatically',
              backstory: 'An experienced DM with vast knowledge of combat storytelling',
              campaignDetails: null, // Would be populated from session context
              characterDetails: null, // Would be populated from session context
              memories: [],
            },
            combatContext: {
              detection: {
                isCombat: combatState.isInCombat,
                combatType: 'active',
                confidence: 1.0,
                shouldStartCombat: false,
                shouldEndCombat: event.type === 'COMBAT_END',
                enemies: [],
                combatActions: [],
              },
              encounter: combatState.activeEncounter,
            },
            isFirstMessage: false,
          });

          // Add DM response to messages (ChatMessage expects `text`)
          if (dmResponse?.response) {
            await addMessage({
              text: dmResponse.response,
              sender: 'dm',
              context: {
                combatData: {
                  type: 'combat_narration',
                  description: `Narration for ${event.type}`,
                },
              },
              narrationSegments: dmResponse.narrationSegments,
            });
          }
        }
      } catch (error) {
        logger.error('Error processing combat event:', error);
      }
    },
    [sessionId, combatState, addMessage],
  );

  // Validate combat action with rules interpreter
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

  // Monitor combat state changes
  useEffect(() => {
    if (!state.activeEncounter) return;

    const encounter = state.activeEncounter;

    // Check for new rounds
    if (encounter.currentRound > lastProcessedRound.current) {
      lastProcessedRound.current = encounter.currentRound;

      const roundEvent: CombatEvent = {
        type: 'ROUND_START',
        roundNumber: encounter.currentRound,
      };

      processCombatEvent(roundEvent);
    }

    // Check for new actions
    if (encounter.actions.length > 0) {
      const latestAction = encounter.actions[encounter.actions.length - 1];

      if (latestAction.id !== lastProcessedAction.current) {
        lastProcessedAction.current = latestAction.id;

        const actionEvent: CombatEvent = {
          type: 'ACTION_TAKEN',
          action: latestAction,
        };

        processCombatEvent(actionEvent);
      }
    }

    // Check for unconscious/dead participants
    encounter.participants.forEach((participant) => {
      if (participant.currentHitPoints === 0) {
        const unconsciousEvent: CombatEvent = {
          type: 'PARTICIPANT_UNCONSCIOUS',
          participantId: participant.id,
        };

        processCombatEvent(unconsciousEvent);
      }

      if (participant.deathSaves.failures >= 3) {
        const deadEvent: CombatEvent = {
          type: 'PARTICIPANT_DEAD',
          participantId: participant.id,
        };

        processCombatEvent(deadEvent);
      }
    });
  }, [state.activeEncounter, processCombatEvent]);

  return {
    validateCombatAction,
    processCombatEvent,
    processDMResponse,
    createCombatActionRoll,
    isInCombat: state.isInCombat,
    encounter: state.activeEncounter,
  };
};
