// External/SDK Imports
import { useRef, useCallback } from 'react';

import type { ImageRequest } from '@/hooks/ai/types';
import type { ChatMessage } from '@/types/game';
import type { RollRequest } from '@/types/roll-request';
import type { DetectedEnemy, DetectedCombatAction } from '@/utils/combatDetection';
import type { SceneSpec } from '../../../server-bun/src/tactical/types';

import { useAuth } from '@/contexts/AuthContext';
import { useCombat } from '@/contexts/CombatContext';
import { useGame } from '@/contexts/GameContext';
import { updateGamePhase, clampCombatIntentFlags } from '@/hooks/ai/game-phase-updater';
import { processRollRequests } from '@/hooks/ai/roll-processor';
import { logIncomingRolls, logRollRequests } from '@/hooks/ai/session-logger';
import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';
import { AIService } from '@/services/ai-service';
import { executeStructuredCombatAction, type StructuredCombatAction } from '@/services/combat/combat-action-executor';
import { MemoryManager } from '@/services/memory-manager';
import { voiceConsistencyService } from '@/services/voice-consistency-service';

// Voice narration types
export interface NarrationSegment {
  type: 'narration' | 'dialogue' | 'action' | 'thought' | 'dm' | 'character';
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
 * Fetches campaign and character details for the DM Agent context.
 *
 * ⚡ Bolt: Extracted from hook to stabilize identity and prevent redundant
 * re-creations during component re-renders.
 */
const fetchGameContext = async (
  sessionId: string,
): Promise<{
  campaign: Record<string, unknown>;
  character: Record<string, unknown>;
  starterCampaignId?: string;
} | null> => {
  try {
    logger.info('Fetching game session details for:', sessionId);

    // ⚡ Bolt: Explicit column selection to avoid over-fetching and include character stats.
    const { data: sessionData, error: sessionError } = await supabase
      .from('game_sessions')
      .select(
        `
        id, campaign_id, character_id, starter_campaign_id,
        campaigns:campaign_id (id, name, description),
        characters:character_id (
          id, name, level, race, class, background,
          character_stats(strength, dexterity, constitution, intelligence, wisdom, charisma)
        )
      `,
      )
      .eq('id', sessionId)
      .single();

    if (sessionError) {
      logger.error('Error fetching session:', sessionError);
      return null;
    }

    if (!sessionData?.campaign_id || !sessionData?.character_id) {
      logger.error('No campaign or character IDs found in session');
      return null;
    }

    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      campaign: (sessionData.campaigns as any) || {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      character: (sessionData.characters as any) || {},
      starterCampaignId: sessionData.starter_campaign_id as string,
    };
  } catch (error) {
    logger.error('Error in fetchGameContext:', error);
    return null;
  }
};

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
export const useAIResponse = () => {
  const { setGamePhase, state: gameState } = useGame();
  const { state: combatState, updateParticipant, nextTurn } = useCombat();
  const { userPlan } = useAuth();
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
        if (!isDiceRollMessage) {
          logger.debug('[useAIResponse] New player action - clearing processed roll requests');
          processedRollRequestsRef.current.clear();
        }

        // Log incoming dice roll results (delegated to session-logger)
        await logIncomingRolls(sessionId, latestMessage);

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
          combatDetected: combatState.isInCombat,
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
        const campaignRecord = gameContext.campaign as Record<string, unknown>;
        const characterRecord = gameContext.character as Record<string, unknown>;
        const aiContext = {
          campaignId: (campaignRecord.id as string) || '',
          characterId: (characterRecord.id as string) || '',
          sessionId,
          starterCampaignId: gameContext.starterCampaignId,
          campaignDetails: gameContext.campaign,
          characterDetails: gameContext.character,
          gameState: {
            currentPhase: gameState.currentPhase,
            isInCombat: combatState.isInCombat,
            currentTurnPlayerId: combatState.activeEncounter?.currentTurnParticipantId,
            pendingRolls: gameState.diceRollQueue.pendingRolls.length,
            round: combatState.activeEncounter?.currentRound,
            participants: (combatState.activeEncounter?.participants || []).map((participant) => ({
              id: participant.id,
              name: participant.name,
              type: participant.participantType,
              hp: participant.currentHitPoints,
              maxHp: participant.maxHitPoints,
              armorClass: participant.armorClass,
              conditions: (participant.conditions || []).map((condition) => condition.name),
            })) || [],
          },
        };

        // The tactical server computes geometry. The DM receives only its bounded
        // ASCII/digest context and never derives distances or line of sight itself.
        if (combatState.isInCombat && sessionId && combatState.activeEncounter?.currentTurnParticipantId) {
          try {
            const token = window.localStorage.getItem('workos_access_token');
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:8888';
            const tacticalResponse = await fetch(`${apiBase}/v1/sessions/${encodeURIComponent(sessionId)}/tactical-map/context/${encodeURIComponent(combatState.activeEncounter.currentTurnParticipantId)}`, {
              headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
            if (tacticalResponse.ok) {
              const payload = await tacticalResponse.json() as { tacticalContext?: string };
              if (payload.tacticalContext) aiContext.gameState.tacticalContext = payload.tacticalContext;
            }
          } catch (error) {
            logger.warn('Unable to load tactical context; continuing without map context', error);
          }
        }

        logger.debug('AI Context with combat awareness:', {
          phase: gameState.currentPhase,
          inCombat: combatState.isInCombat,
          pendingRolls: gameState.diceRollQueue.pendingRolls.length,
          currentTurn: combatState.activeEncounter?.currentTurnParticipantId,
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

        if (sessionId && result.map_actions?.length) {
          const token = window.localStorage.getItem('workos_access_token');
          const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:8888';
          for (const action of result.map_actions) {
            const actionResponse = await fetch(`${apiBase}/v1/sessions/${encodeURIComponent(sessionId)}/tactical-map/action`, {
              method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(action),
            });
            if (!actionResponse.ok) {
              const refusal = await actionResponse.json();
              // Exactly one corrective structured pass: the engine refusal is authoritative.
              const correction = await AIService.chatWithDM({
                message: JSON.stringify({ tacticalRefusal: refusal, instruction: 'Replace only the refused map_action. Return no prose and no combat actions.' }),
                context: { ...aiContext, gameState: { ...aiContext.gameState, tacticalCorrection: true } },
                conversationHistory,
                userPlan: userPlan || undefined,
                turnCount,
              });
              const replacement = correction.map_actions?.[0];
              if (replacement) {
                const retry = await fetch(`${apiBase}/v1/sessions/${encodeURIComponent(sessionId)}/tactical-map/action`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(replacement),
                });
                if (retry.ok) continue;
              }
              logger.warn('Dropped invalid DM tactical action after one corrective retry', refusal);
            }
          }
        }

        if (combatState.isInCombat && combatState.activeEncounter && result.combat_actions?.length) {
          const resolvedActions: Array<Record<string, unknown>> = [];
          for (const action of result.combat_actions as StructuredCombatAction[]) {
            const outcomes = await executeStructuredCombatAction(combatState.activeEncounter.id, action);
            resolvedActions.push({ action, outcomes });
            for (const outcome of outcomes) {
              if (outcome.newHp !== undefined) {
                await updateParticipant(outcome.participantId, { currentHitPoints: outcome.newHp });
              }
            }
            await nextTurn();
          }
          const narrationResult = await AIService.chatWithDM({
            message: JSON.stringify({ authoritativeCombatResults: resolvedActions }),
            context: { ...aiContext, gameState: { ...aiContext.gameState, resolutionOnly: true } },
            conversationHistory: [...conversationHistory, {
              id: `resolution-setup-${Date.now()}`, role: 'assistant' as const,
              content: result.text, timestamp: new Date(),
            }],
            userPlan: userPlan || undefined,
            turnCount,
          });
          result = narrationResult;
          responseText = narrationResult.text;
          narrationSegments = narrationResult.narrationSegments;
        }

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
          isInCombat: combatState.isInCombat,
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
            await voiceConsistencyService.processVoiceAssignments(sessionId, narrationSegments);
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
          combatState.isInCombat,
        );

        // Append NPC roll continuation to response text
        let finalResponseText = responseText;
        if (processedRolls.npcRollContinuationText) {
          finalResponseText = `${responseText}\n\n${processedRolls.npcRollContinuationText}`;
          logger.info('Appended NPC roll continuation to response');
        }

        // Format the response as an EnhancedChatMessage
        return {
          text: finalResponseText,
          sender: 'dm',
          timestamp: new Date().toISOString(),
          context: {
            emotion: 'neutral',
            intent: 'response',
            npcRollResults:
              processedRolls.npcRollResults.length > 0 ? processedRolls.npcRollResults : undefined,
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
      combatState.isInCombat,
      combatState.activeEncounter?.currentTurnParticipantId,
      userPlan,
      setGamePhase,
    ],
  );

  return { getAIResponse };
};
