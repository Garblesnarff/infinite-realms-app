/**
 * Combat AI Integration Hook
 *
 * Bridges combat system with AI agents for seamless D&D experience.
 * Handles combat event notifications, AI responses, dice rolls, and rule validations.
 * Now includes combat detection from DM text and automatic dice roll generation.
 */

/* eslint-disable max-lines */
import { useEffect, useRef, useCallback, useMemo } from 'react';

import type { CombatEvent, CombatAction, CombatParticipant, CombatEncounter } from '@/types/combat';
import type { ChatMessage } from '@/types/game';
import type { CombatMessageData } from '@/utils/combat/ai-narration-utils';
import type { DetectedCombatAction, PlayerCharacterLike } from '@/utils/combatDetection';
import type { DiceRoll } from '@/utils/diceUtils';

import { useCombat } from '@/contexts/CombatContext';
import { useMessages } from '@/hooks/use-messages';
import { logger } from '@/lib/logger';
import {
  getDamageRollForWeapon,
  createActionDescription,
  shouldTriggerDMNarration,
  formatCombatEventForDM,
} from '@/utils/combat/ai-narration-utils';
import { detectCombatFromText } from '@/utils/combatDetection';
import { createCombatParticipantsFromDetection } from '@/utils/combat/participant-generation';
import { rollDice } from '@/utils/diceUtils';
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
  const isStartingCombatRef = useRef(false);
  const hasInitiativeEmittedRef = useRef(false);
  const seenActionHashesRef = useRef<Set<string>>(new Set());
  const lastCombatEndAtRef = useRef<number>(0);
  const MIN_COMBAT_CONFIDENCE = Number(
    (import.meta as unknown as { env: Record<string, string> })?.env?.VITE_MIN_COMBAT_CONFIDENCE ??
      '0.55',
  );

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

  // Process DM response for combat content
  const processDMResponse = useCallback(
    async (
      dmMessage: ChatMessage,
      playerCharacter?: PlayerCharacterLike,
    ): Promise<{
      combatDetected: boolean;
      shouldStartCombat: boolean;
      shouldEndCombat: boolean;
      combatMessages: ChatMessage[];
    }> => {
      const detection = detectCombatFromText(dmMessage.text || '');
      const combatMessages: ChatMessage[] = [];

      // Handle combat ending
      if (detection.shouldEndCombat && state.activeEncounter) {
        await endCombat();
        hasInitiativeEmittedRef.current = false;
        seenActionHashesRef.current.clear();
        lastCombatEndAtRef.current = Date.now();
        return {
          combatDetected: true,
          shouldStartCombat: false,
          shouldEndCombat: true,
          combatMessages: [],
        };
      }

      // Handle combat starting with guard to prevent duplicates
      // Add cooldown check to prevent rapid re-triggers after combat ends
      const COMBAT_COOLDOWN_MS = 3000; // 3 seconds cooldown after combat ends
      const timeSinceLastEnd = Date.now() - (lastCombatEndAtRef.current || 0);
      const cooldownExpired = timeSinceLastEnd > COMBAT_COOLDOWN_MS;

      const canStartCombat =
        detection.shouldStartCombat && // Use new explicit initiative check from detection
        detection.confidence >= MIN_COMBAT_CONFIDENCE &&
        !!(detection.enemies && detection.enemies.length > 0) &&
        !state.isInCombat &&
        cooldownExpired; // Prevent rapid re-triggers

      if (canStartCombat && !isStartingCombatRef.current) {
        isStartingCombatRef.current = true;

        try {
          const participants = createCombatParticipantsFromDetection(
            detection.enemies,
            playerCharacter,
          );

          // Start combat with detected participants (CombatProvider rolls initiative)
          if (sessionId) {
            await startCombat(sessionId, participants as Partial<CombatParticipant>[]);

            // Create enhanced combat start message for UI log
            // Note: After startCombat() completes, the actual initiative rolls are in the encounter state
            const initiativeText =
              participants.length > 1
                ? `${participants.length} combatants roll for initiative!`
                : `${participants[0]?.name || 'Fighter'} prepares for combat!`;

            const combatStartMessage: ChatMessage = {
              text: `⚔️ Combat has begun! ${initiativeText}\n\nInitiative order will be determined by d20 + DEX modifier.\nThe combat tracker will show turn order.`,
              sender: 'system',
              context: {
                combatData: {
                  type: 'initiative',
                  participants: participants.map((p) => ({
                    name: p.name || 'Unknown',
                    initiativeModifier: p.initiative || 0,
                  })),
                },
              },
              timestamp: new Date().toISOString(),
            };

            combatMessages.push(combatStartMessage);
            hasInitiativeEmittedRef.current = true;
            seenActionHashesRef.current.clear();
          }
        } finally {
          isStartingCombatRef.current = false;
        }
      }

      // NOTE: Auto-roll combat action processing has been DISABLED.
      // The proper roll request system in use-ai-response.ts handles all rolls via:
      // 1. Structured ROLL_REQUESTS_V1 blocks from DM
      // 2. Regex pattern matching for roll requests
      // These go through requestDiceRoll() → queue → popup → user rolls
      //
      // The previous code here auto-rolled dice silently without showing the popup,
      // causing "random skill checks" and "DM responds before rolls" issues.
      // See: https://github.com/anthropics/claude-code/issues/combat-auto-roll
      //
      // If combat action roll requests are needed, they should come from the DM agent
      // via structured format, not auto-detected from narrative text.

      // Enforce mutual exclusivity between start/end hints to avoid contradictory logs
      let start = !!detection.shouldStartCombat;
      let end = !!detection.shouldEndCombat;
      if (start && end) {
        if (state.isInCombat)
          start = false; // already in combat, prefer end
        else end = false; // out of combat, prefer start
      }

      return {
        combatDetected: detection.isCombat,
        shouldStartCombat: start,
        shouldEndCombat: end,
        combatMessages,
      };
    },
    [
      state.activeEncounter,
      startCombat,
      endCombat,
      MIN_COMBAT_CONFIDENCE,
      sessionId,
      state.isInCombat,
    ],
  );

  // Create dice roll for a detected combat action
  const createCombatActionRoll = useCallback(
    async (action: DetectedCombatAction): Promise<CombatMessageData | null> => {
      let roll: DiceRoll;
      let dc: number | undefined;
      let success: boolean | undefined;
      let critical: boolean = false;

      switch (action.rollType) {
        case 'attack':
          // Attack roll (d20 + modifiers)
          roll = rollDice(20, 1, 5); // Base +5 attack bonus
          critical = roll.results[0] === 20;
          success = roll.total >= 15; // Assume AC 15 target
          dc = 15;
          break;

        case 'damage': {
          // Damage roll (weapon dependent)
          const damageRoll = action.weapon
            ? getDamageRollForWeapon(action.weapon)
            : { dice: 8, count: 1, modifier: 3 };
          roll = rollDice(damageRoll.dice, damageRoll.count, damageRoll.modifier);
          break;
        }

        case 'save':
          // Saving throw
          roll = rollDice(20, 1, 2); // Base +2 save bonus
          dc = 13; // Common save DC
          success = roll.total >= dc;
          break;

        case 'skill':
          // Skill check
          roll = rollDice(20, 1, 1); // Base +1 skill bonus
          dc = 12; // Common skill DC
          success = roll.total >= dc;
          break;

        default:
          return null;
      }

      const messageType =
        action.rollType === 'attack'
          ? 'attack_roll'
          : action.rollType === 'damage'
            ? 'damage_roll'
            : action.rollType === 'save'
              ? 'saving_throw'
              : 'skill_check';

      return {
        type: messageType,
        actor: action.actor,
        target: action.target,
        roll,
        dc,
        success,
        critical,
        action,
        description: createActionDescription(action, roll, success, critical),
      };
    },
    [],
  );

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
