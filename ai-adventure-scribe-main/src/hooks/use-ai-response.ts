// External/SDK Imports
import { useRef } from 'react';

import type { ImageRequest } from '@/hooks/ai/types';
import type { ChatMessage } from '@/types/game';
import type { RollRequest } from '@/types/roll-request';
import type { DetectedEnemy, DetectedCombatAction } from '@/utils/combatDetection';

import { useAuth } from '@/contexts/AuthContext';
import { useCombat } from '@/contexts/CombatContext';
import { useGame } from '@/contexts/GameContext';
import { updateGamePhase, clampCombatIntentFlags } from '@/hooks/ai/game-phase-updater';
import { processRollRequests } from '@/hooks/ai/roll-processor';
import { logIncomingRolls, logRollRequests } from '@/hooks/ai/session-logger';
import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';
import { AIService } from '@/services/ai-service';
import { MemoryManager } from '@/services/memory-manager';
import { voiceConsistencyService } from '@/services/voice-consistency-service';
import { detectCombatFromText } from '@/utils/combatDetection';

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
export const useAIResponse = () => {
  const { setGamePhase, state: gameState } = useGame();
  const { state: combatState } = useCombat();
  const { userPlan } = useAuth();
  const lastSigRef = useRef<string>('');
  // Track processed roll request signatures to prevent infinite re-parsing loops
  const processedRollRequestsRef = useRef<Set<string>>(new Set());

  /**
   * Fetches campaign and character details for the DM Agent context.
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
   * Calls the DM Agent to generate a response based on chat history and game context.
   * Handles structured responses with narration segments for voice synthesis.
   */
  const getAIResponse = async (
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

      // Analyze player message for combat context
      const combatDetection = detectCombatFromText(latestMessage.text);

      logger.debug('Calling DM Agent with context:', {
        gameContext,
        knownCharacters: Object.keys(voiceContext.knownCharacters).length,
        isFirstMessage,
        combatDetected: combatDetection.isCombat,
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
        },
      };

      logger.debug('AI Context with combat awareness:', {
        phase: gameState.currentPhase,
        inCombat: combatState.isInCombat,
        pendingRolls: gameState.diceRollQueue.pendingRolls.length,
        currentTurn: combatState.activeEncounter?.currentTurnParticipantId,
      });

      // Call AIService
      const result = await AIService.chatWithDM({
        message: latestMessage.text,
        context: aiContext,
        conversationHistory,
        userPlan: userPlan || undefined,
        turnCount,
        relevantMemories,
      });

      // Extract response data (result type has both snake_case and camelCase variants)
      const responseText = result.text;
      const narrationSegments = result.narrationSegments;
      const diceRolls = (result.dice_rolls || []) as DiceRoll[];
      const imageRequests: ImageRequest[] | undefined = undefined;

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
        !!combatDetection.shouldStartCombat,
        !!combatDetection.shouldEndCombat,
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
        combatDetection: {
          isCombat: combatDetection.isCombat,
          confidence: combatDetection.confidence,
          combatType: combatDetection.combatType,
          shouldStartCombat,
          shouldEndCombat,
          enemies: combatDetection.enemies || [],
          combatActions: combatDetection.combatActions || [],
        },
      };
    } catch (error) {
      logger.error('Error in getAIResponse:', error);
      throw error;
    }
  };

  return { getAIResponse };
};
