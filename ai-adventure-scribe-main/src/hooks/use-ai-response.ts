// External/SDK Imports
import { useRef, useCallback } from 'react';

import type { SceneSpec } from '../../../server-bun/src/tactical/types';
import type { ImageRequest } from '@/hooks/ai/types';
import type { ChatMessage } from '@/types/game';
import type { RollRequest } from '@/types/roll-request';
import type { DetectedEnemy, DetectedCombatAction } from '@/utils/combatDetection';

import { useAuth } from '@/contexts/AuthContext';
import { useCombat } from '@/contexts/CombatContext';
import { useGame } from '@/contexts/GameContext';
import { fetchGameContext, buildAIContext } from '@/hooks/ai/ai-utils';
import { handleDmActionsAndTransitions } from '@/hooks/ai/dm-actions-handler';
import { updateGamePhase, clampCombatIntentFlags } from '@/hooks/ai/game-phase-updater';
import { processRollRequests } from '@/hooks/ai/roll-processor';
import { logIncomingRolls, logRollRequests } from '@/hooks/ai/session-logger';
import logger from '@/lib/logger';
import { AIService } from '@/services/ai-service';
import {
  hasPendingPlayerRoll,
  settlePendingPlayerRoll,
} from '@/services/combat/player-roll-bridge';
import { MemoryManager } from '@/services/memory-manager';
import { userDataApi } from '@/services/user-data-api';
import { voiceConsistencyService } from '@/services/voice-consistency-service';
import { stripEngineGeneratedLinesFromSegments } from '@/utils/engine-lines';
import { ensureActionOptions } from '@/utils/ensure-action-options';

// Voice narration types
export interface NarrationSegment {
  type: 'narration' | 'dialogue' | 'action' | 'thought' | 'dm' | 'character' | 'transition';
  text: string;
  character?: string;
  voice_category?: string;
}

export interface DiceRoll {
  type: 'attack' | 'damage' | 'saving_throw' | 'ability_check' | 'initiative' | 'skill_check';
  dice_notation: string; // e.g., "1d20+4", "2d6+3"
  result: number;
  modifier: number;
  target?: number; // DC or AC
  success?: boolean;
  critical?: boolean;
  actor: string;
  context: string; // Description of what the roll is for
}

export interface StructuredAIResponse {
  response: string;
  narration_segments?: NarrationSegment[];
  dice_rolls?: DiceRoll[];
  roll_requests?: RollRequest[];
}

export interface EnhancedChatMessage extends ChatMessage {
  narrationSegments?: NarrationSegment[];
  diceRolls?: DiceRoll[];
  rollRequests?: RollRequest[];
  imageRequests?: ImageRequest[];
  sceneSpec?: SceneSpec | null;
  combatDetection?: {
    isCombat: boolean;
    confidence: number;
    combatType?: string;
    shouldStartCombat: boolean;
    shouldEndCombat: boolean;
    enemies: DetectedEnemy[];
    combatActions: DetectedCombatAction[];
  };
}

// Re-export RollRequest for backward compatibility
export type { RollRequest } from '@/types/roll-request';

/**
 * useAIResponse Hook
 *
 * Handles AI response generation with memory context window.
 * Formats tasks, fetches game context, and calls the DM Agent.
 *
 * Roll processing, session logging, and phase updates are delegated
 * to extracted modules in src/hooks/ai/.
 *
 * @author AI Dungeon Master Team
 */
export const useAIResponse = (): {
  getAIResponse: (
    messages: ChatMessage[],
    sessionId: string,
    turnCount?: number,
  ) => Promise<EnhancedChatMessage>;
} => {
  const { setGamePhase, state: gameState } = useGame();
  const { refreshCombatState } = useCombat();
  const { user, userPlan } = useAuth();
  const lastSigRef = useRef<string>('');
  // Track processed roll request signatures to prevent infinite re-parsing loops
  const processedRollRequestsRef = useRef<Set<string>>(new Set());

  /**
   * Calls the DM Agent to generate a response based on chat history and game context.
   * Handles structured responses with narration segments for voice synthesis.
   *
   * ⚡ Bolt: Memoized response generation to prevent downstream re-renders of
   * components consuming this hook when the parent component re-renders.
   */
  const getAIResponse = useCallback(
    async (
      messages: ChatMessage[],
      sessionId: string,
      turnCount?: number,
    ): Promise<EnhancedChatMessage> => {
      try {
        logger.info('Getting AI response for session:', sessionId);

        const latestMessage = messages[messages.length - 1];

        // Guard against repeated message processing
        const sig = `${sessionId}|${latestMessage.text}|${messages.length}`;
        if (lastSigRef.current === sig) {
          logger.debug('[useAIResponse] Skipping duplicate message processing for signature:', sig);
          return {
            text: '',
            sender: 'dm',
            timestamp: new Date().toISOString(),
            context: { emotion: 'neutral', intent: 'response' },
          };
        }
        lastSigRef.current = sig;

        // Clear processed roll requests on new player ACTION (not dice roll)
        const isDiceRollMessage = latestMessage.context?.intent === 'dice_roll';
        // Taking any other action is an answer to a waiting attack die too, and the answer is
        // "not this one". Settle it engine-rolled before this turn starts, so the pending
        // attack resolves instead of sitting behind a popup the player has visibly left. There
        // is deliberately no wall-clock timeout: a popup open overnight is a player who came
        // back, not a failure.
        if (!isDiceRollMessage && hasPendingPlayerRoll()) {
          logger.info('[PlayerRoll] superseded by a new player action; the engine rolls it');
          settlePendingPlayerRoll({ d20: null });
        }
        if (!isDiceRollMessage) {
          logger.debug('[useAIResponse] New player action - clearing processed roll requests');
          processedRollRequestsRef.current.clear();
        }

        // Log incoming dice roll results (delegated to session-logger)
        await logIncomingRolls(sessionId, latestMessage);

        // Combat truth for this turn is re-read from the server rather than taken from the last
        // render. Everything below — the tactical-context fetch, the combat flag the DM is told,
        // and structured action execution — reads these two locals, so a fight the server ended
        // on a killing blow (or started while this closure was already captured) is seen here.
        let activeEncounter = await refreshCombatState();
        let isInCombat = activeEncounter?.phase === 'active';

        // Detect if this is the first player message in the session
        const isFirstMessage = messages.filter((m) => m.sender === 'player').length <= 1;

        // ⚡ Bolt: Parallelize fetching game context, voice context, and relevant memories to reduce latency.
        // This reduces total request time by executing all context retrieval concurrently.
        const [gameContext, voiceContext, relevantMemories] = await Promise.all([
          fetchGameContext(sessionId),
          voiceConsistencyService.getSessionVoiceContext(sessionId),
          MemoryManager.getRelevantMemories(sessionId, latestMessage.text, 8),
        ]);

        if (!gameContext) {
          throw new Error('Failed to fetch game context');
        }

        logger.debug('Calling DM Agent with context:', {
          gameContext,
          knownCharacters: Object.keys(voiceContext.knownCharacters).length,
          isFirstMessage,
          combatDetected: isInCombat,
        });

        // Build conversation history for AIService
        const conversationHistory = messages.slice(0, -1).map((msg) => ({
          id: `msg_${Date.now()}_${Math.random()}`,
          role: msg.sender === 'player' ? ('user' as const) : ('assistant' as const),
          content: msg.text,
          timestamp: new Date(),
          narrationSegments: msg.narrationSegments,
        }));

        // Create AI context with combat awareness
        const characterRecord = gameContext.character as Record<string, unknown>;
        const aiContext = buildAIContext({
          sessionId,
          userId: user?.id,
          starterCampaignId: gameContext.starterCampaignId,
          campaign: gameContext.campaign,
          character: gameContext.character,
          currentPhase: gameState.currentPhase,
          isInCombat,
          encounterId: activeEncounter?.id,
          currentTurnParticipantId: activeEncounter?.currentTurnParticipantId,
          pendingRollsCount: gameState.diceRollQueue.pendingRolls.length,
          currentRound: activeEncounter?.currentRound,
          participants: activeEncounter?.participants,
        });

        // The tactical server computes geometry. The DM receives only its bounded
        // ASCII/digest context and never derives distances or line of sight itself.
        if (isInCombat && sessionId && activeEncounter?.currentTurnParticipantId) {
          try {
            const tacticalResponse = await userDataApi.getTacticalMapContext(
              sessionId,
              activeEncounter.currentTurnParticipantId,
            );
            if (tacticalResponse.ok) {
              const payload = (await tacticalResponse.json()) as { tacticalContext?: string };
              if (payload.tacticalContext)
                aiContext.gameState.tacticalContext = payload.tacticalContext;
            }
          } catch (error) {
            logger.warn('Unable to load tactical context; continuing without map context', error);
          }
        }

        logger.debug('AI Context with combat awareness:', {
          phase: gameState.currentPhase,
          inCombat: isInCombat,
          pendingRolls: gameState.diceRollQueue.pendingRolls.length,
          currentTurn: activeEncounter?.currentTurnParticipantId,
        });

        // Call AIService
        let result = await AIService.chatWithDM({
          message: latestMessage.text,
          context: aiContext,
          conversationHistory,
          userPlan: userPlan || undefined,
          turnCount,
          relevantMemories,
        });

        // Extract response data (result type has both snake_case and camelCase variants)
        let responseText = result.text;
        let narrationSegments = result.narrationSegments;
        const diceRolls = (result.dice_rolls || []) as DiceRoll[];
        const imageRequests: ImageRequest[] | undefined = undefined;

        // Process DM Actions and transitions
        const dmActionsResult = await handleDmActionsAndTransitions({
          sessionId,
          result,
          characterRecord,
          activeEncounter,
          isInCombat,
          refreshCombatState,
          aiContext,
          conversationHistory,
          userPlan: userPlan || undefined,
          turnCount,
          playerMessage: latestMessage.text,
          isDiceRollMessage: !!isDiceRollMessage,
        });

        result = dmActionsResult.result;
        responseText = dmActionsResult.responseText;
        narrationSegments = dmActionsResult.narrationSegments;
        const deliveredHandouts = dmActionsResult.deliveredHandouts;
        isInCombat = dmActionsResult.isInCombat;
        activeEncounter = dmActionsResult.activeEncounter;

        // Process roll requests (parse, deduplicate, execute NPC rolls)
        const processedRolls = await processRollRequests({
          responseText,
          existingRequests: result.roll_requests || [],
          isDiceRollMessage: !!isDiceRollMessage,
          processedSet: processedRollRequestsRef.current,
          aiContext,
          sessionId,
          characterId: (characterRecord.id as string) || 'player',
        });

        // Log outgoing roll requests (delegated to session-logger)
        await logRollRequests(sessionId, processedRolls.playerRollRequests);

        // Update game phase based on combat detection (delegated to game-phase-updater)
        updateGamePhase({
          combatDetection: result.combatDetection,
          currentPhase: gameState.currentPhase,
          isInCombat,
          setGamePhase,
        });

        // Process voice assignments if we have narration segments
        if (narrationSegments && narrationSegments.length > 0) {
          logger.info(
            'Received structured response with',
            narrationSegments.length,
            'narration segments',
          );
          try {
            await voiceConsistencyService.processVoiceAssignments(
              sessionId,
              stripEngineGeneratedLinesFromSegments(narrationSegments),
            );
            logger.info('Processed voice assignments successfully');
          } catch (voiceError) {
            logger.warn('Warning: Failed to process voice assignments:', voiceError);
          }
        } else {
          logger.info('Received text-only response');
        }

        // Clamp combat intent flags (delegated to game-phase-updater)
        const { shouldStartCombat, shouldEndCombat } = clampCombatIntentFlags(
          !!result.combatDetection?.shouldStartCombat,
          !!result.combatDetection?.shouldEndCombat,
          isInCombat,
        );

        // Append NPC roll continuation to response text
        let finalResponseText = responseText;
        if (processedRolls.npcRollContinuationText) {
          finalResponseText = `${responseText}\n\n${processedRolls.npcRollContinuationText}`;
          logger.info('Appended NPC roll continuation to response');
        }

        // Guarantee clickable options on ordinary narrative turns. Combat turns
        // render server-provided legal actions, and roll-request turns pause on
        // the dice UI, so both are excluded.
        if (
          !isInCombat &&
          !shouldStartCombat &&
          result.combat_transition !== 'start' &&
          processedRolls.playerRollRequests.length === 0
        ) {
          finalResponseText = await ensureActionOptions(finalResponseText);
        }

        // Format the response as an EnhancedChatMessage
        return {
          text: finalResponseText,
          sender: 'dm',
          timestamp: new Date().toISOString(),
          context: {
            emotion: 'neutral',
            intent: 'response',
            combat_transition: result.combat_transition ?? 'none',
            scene_spec: result.scene_spec != null,
            npcRollResults:
              processedRolls.npcRollResults.length > 0 ? processedRolls.npcRollResults : undefined,
            handouts: deliveredHandouts,
          },
          narrationSegments,
          diceRolls,
          rollRequests: processedRolls.playerRollRequests,
          imageRequests,
          sceneSpec: (result.scene_spec as SceneSpec | null | undefined) ?? null,
          combatDetection: {
            isCombat: result.combatDetection?.isCombat || false,
            confidence: result.combatDetection?.confidence || 1,
            combatType: result.combatDetection?.combatType || 'none',
            shouldStartCombat,
            shouldEndCombat,
            enemies: result.combatDetection?.enemies || [],
            combatActions: result.combatDetection?.combatActions || [],
          },
        };
      } catch (error) {
        logger.error('Error in getAIResponse:', error);
        throw error;
      }
    },
    [
      gameState.currentPhase,
      gameState.diceRollQueue.pendingRolls.length,
      refreshCombatState,
      userPlan,
      user?.id,
      setGamePhase,
    ],
  );

  return { getAIResponse };
};
