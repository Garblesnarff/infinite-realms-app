import React from 'react';

import { useMessageCommandHandler } from './use-message-command-handler';
import { useMessageSendQueue } from './use-message-send-queue';
import { useSessionValidator } from '../session/SessionValidator';

import type { ExtendedGameSession, SessionStateUpdater } from '../../../types/session';
import type { DiceRollContext } from '../../chat/MessageList';
import type { ChatMessage } from '@/types/game';

import { useCharacter } from '@/contexts/CharacterContext';
import { useGame } from '@/contexts/GameContext';
import { useMemoryContext } from '@/contexts/MemoryContext';
import { useMessageContext } from '@/contexts/MessageContext';
import { useAIResponse } from '@/hooks/use-ai-response';
import { useToast } from '@/hooks/use-toast';
import logger from '@/lib/logger';
import { CombatIntentRefusedError } from '@/services/combat/combat-action-executor';
import { sanitizeDMText } from '@/utils/chatSanitizer';
import { stripEngineGeneratedLines } from '@/utils/engine-lines';
import { handleAsyncError } from '@/utils/error-handler';
import { parseMessageOptions } from '@/utils/parseMessageOptions';
import { truncateAtRollRequest } from '@/utils/roll-request/validate';

interface UseMessageHandlerLogicProps {
  sessionId: string;
  campaignId: string | null;
  characterId: string | null;
  turnCount: number;
  updateGameSessionState: (newStateOrUpdater: SessionStateUpdater) => Promise<void>;
  onAIResponse?: (message: ChatMessage) => Promise<void>;
}

/**
 * ⚡ Bolt: Static configuration and helper functions hoisted outside the hook
 * to reduce render cycle overhead and stabilize identity.
 */
const headerMode = String(import.meta?.env?.VITE_SCENE_SUMMARY_HEADER ?? 'short').toLowerCase();

const toHeaderExcerpt = (raw: string, limit = 220) => {
  if (!raw) return '';
  const cleaned = raw
    .replace(/^VISUAL\s+PROMPT:.*$/gim, '')
    .replace(/^\s*[A-F]\.\s.*$/gim, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const sentences = cleaned.split(/(?<=[.!?])\s+/);
  let out = sentences.slice(0, 2).join(' ');
  if (out.length > limit) {
    out = out.slice(0, limit).replace(/[ ,;:]+\S*$/, '') + '…';
  }
  return out;
};

export const useMessageHandlerLogic = ({
  sessionId,
  campaignId,
  characterId,
  turnCount,
  updateGameSessionState,
  onAIResponse,
}: UseMessageHandlerLogicProps): {
  handleSendMessage: (playerInput: string, context?: DiceRollContext) => Promise<void>;
  isProcessing: boolean;
} => {
  const { messages, sendMessage, queueStatus } = useMessageContext();
  const { extractMemories } = useMemoryContext();
  const { getAIResponse } = useAIResponse();
  const { processAiResponse } = useGame();
  const { toast } = useToast();
  const { state: characterState } = useCharacter();
  const character = characterState.character;

  const { handleSafetyCommand, handleDiceCommand } = useMessageCommandHandler({
    sessionId,
    updateGameSessionState,
    onAIResponse,
  });

  // Extract message queue and sending-state logic
  const { handleSendMessage, isSendingRef, actualSendMessageRef } = useMessageSendQueue();

  // Refs to track current values for async operations
  const turnCountRef = React.useRef(turnCount);
  const messagesRef = React.useRef(messages);

  // Update refs when values change
  React.useEffect(() => {
    turnCountRef.current = turnCount;
  }, [turnCount]);

  React.useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Assuming validateSession is still relevant or adapted
  const validateSession = useSessionValidator({ sessionId, campaignId, characterId });

  // The actual message sending logic (extracted from handleSendMessage)
  const actualSendMessage = async (
    playerInput: string,
    providedContext?: DiceRollContext,
  ): Promise<void> => {
    try {
      logger.info('[Memory Flow] Starting message handling for:', playerInput);

      // Validate session before proceeding (if still needed)
      const isValid = await validateSession();
      if (!isValid) return;

      // Check if this is a manual safety command
      const manualSafetyResult = await handleSafetyCommand(playerInput);
      if (manualSafetyResult.isSafetyCommand) {
        return;
      }

      // Check if this is a dice roll command
      const diceCommandResult = await handleDiceCommand(playerInput);
      if (diceCommandResult.isDiceCommand) {
        return;
      }

      // Use ref to get current turn count to avoid stale closure
      const currentTurnCount = turnCountRef.current;
      const newTurnCount = currentTurnCount + 1;
      const currentMessages = messagesRef.current;
      const isFirstMessage = currentMessages.length === 0;

      // Add player message
      // CRITICAL FIX: Use provided context if available (for dice roll results)
      // This preserves the 'dice_roll' intent through the message flow,
      // enabling the roll suppression logic in use-ai-response.ts
      const playerMessage: ChatMessage = {
        text: playerInput,
        sender: 'player',
        characterName: character?.name,
        characterAvatar: character?.avatar_url,
        context: providedContext ?? {
          intent: isFirstMessage ? 'first_action' : 'query',
          isFirstMessage,
        },
      };
      await sendMessage(playerMessage); // This adds to UI and saves to dialogue_history

      // Update turn count immediately after player message is sent using functional form
      await updateGameSessionState((prev: ExtendedGameSession) => ({
        ...prev,
        turn_count: (prev.turn_count || 0) + 1,
      }));

      // Update the ref to reflect the new turn count
      turnCountRef.current = newTurnCount;

      logger.info('[Memory Flow] Extracting memories from player input');
      // Skip extraction for dice roll results — the formatted roll text
      // (e.g., "Stealth Check: 15 (nat 13+2) vs DC 13 ✓") is transient scaffolding,
      // not a durable game memory. The AI response that follows the roll IS extracted.
      if (providedContext?.intent !== 'dice_roll') {
        await extractMemories(playerInput); // Assuming this is non-critical path for state update
      }

      // Optional: System acknowledgment (can be removed if AI response is fast)
      // const systemMessage: ChatMessage = { text: "Processing...", sender: 'system', context: { intent: 'acknowledgment' } };
      // await sendMessage(systemMessage);

      logger.info('[Memory Flow] Getting AI response for session:', sessionId);
      // Pass necessary context to getAIResponse. It fetches its own campaign/char details if needed.
      // Use ref to get current messages to avoid stale closure
      const aiResponseMessage = await getAIResponse(
        [...messagesRef.current, playerMessage],
        sessionId,
      );
      // Sanitize the AI response text first
      let processedText = sanitizeDMText(aiResponseMessage.text);

      // CRITICAL: Truncate at roll request to prevent premature outcome narrative
      // The AI may generate outcome text AFTER the roll request block - we must NOT display it
      // The player should only see text BEFORE the roll request; outcome comes in NEW response after roll
      if (aiResponseMessage.rollRequests && aiResponseMessage.rollRequests.length > 0) {
        processedText = truncateAtRollRequest(processedText);
        logger.info('🎲 Truncated AI response at roll request to prevent premature outcome');
      }

      const sanitizedAiResponseMessage: ChatMessage = {
        ...aiResponseMessage,
        text: processedText,
      };

      // Check for auto-triggered safety commands in AI response
      const autoSafetyResult = await handleSafetyCommand(
        playerInput,
        sanitizedAiResponseMessage.text,
      );
      if (autoSafetyResult.isSafetyCommand) {
        return;
      }

      // Check if this response contains roll requests
      const hasRollRequests =
        sanitizedAiResponseMessage.rollRequests &&
        sanitizedAiResponseMessage.rollRequests.length > 0;

      // Engine-authored notices may have different persistence owners. The seating transcript
      // is already written by the server's `/enter` endpoint, while decline/failure/no-host and
      // queued-intent notices still belong in the client message history.
      const localNotices =
        aiResponseMessage.localNotices ??
        (aiResponseMessage.localNotice
          ? [{ text: aiResponseMessage.localNotice, persist: true }]
          : []);
      for (const notice of localNotices) {
        await sendMessage({
          text: notice.text,
          sender: 'system',
          timestamp: new Date().toISOString(),
          persist: notice.persist,
          context: { intent: 'combat_pending_intent' },
        });
      }

      if (hasRollRequests) {
        // DO NOT display AI message - suppress the narrative completely
        // Only process the roll requests (show the dice popup)
        // The narrative will come from a NEW AI response after the roll completes
        logger.info(
          '🎲 Suppressing AI narrative - roll requested. Showing',
          sanitizedAiResponseMessage.rollRequests.length,
          'dice popup(s) only.',
        );
        processAiResponse(sanitizedAiResponseMessage.rollRequests);
      } else {
        // No roll requests - display the message normally
        // A queued out-of-turn declaration intentionally has no DM outcome to display. The
        // system notice above is the complete response when the NPC batch was empty.
        if (
          sanitizedAiResponseMessage.text ||
          sanitizedAiResponseMessage.narrationSegments?.length
        ) {
          await sendMessage(sanitizedAiResponseMessage);
        }
      }

      // Only process combat detection, voice, scene updates, and memories
      // when the message is actually displayed (not when suppressed for roll requests)
      if (!hasRollRequests) {
        // Process AI response for combat detection and other features
        if (onAIResponse) {
          try {
            logger.info('[Combat Flow] Processing AI response for combat detection');
            await onAIResponse({
              ...sanitizedAiResponseMessage,
              text: stripEngineGeneratedLines(sanitizedAiResponseMessage.text),
            });
          } catch (combatError) {
            handleAsyncError(combatError, {
              userMessage: 'Failed to process combat response',
              logLevel: 'warn',
              showToast: false,
              context: { location: 'MessageHandler.onAIResponse.combatDetection' },
            });
            // Don't throw here - combat processing should not break the message flow
          }
        }

        // Check if we have narration segments for voice synthesis
        if (
          sanitizedAiResponseMessage.narrationSegments &&
          sanitizedAiResponseMessage.narrationSegments.length > 0
        ) {
          logger.info(
            '[Voice Flow] AI response contains',
            sanitizedAiResponseMessage.narrationSegments.length,
            'narration segments',
          );
          // Note: Voice playback will be handled by MultiVoicePlayer component
          // when it detects the narrationSegments in the message
        }

        // Update current_scene_description with short blurb (not full reply)
        if (sanitizedAiResponseMessage.text) {
          const blurb =
            headerMode === 'off' ? '' : toHeaderExcerpt(sanitizedAiResponseMessage.text);
          await updateGameSessionState((prev: ExtendedGameSession) => ({
            ...prev,
            current_scene_description: blurb,
          }));

          // CRITICAL FIX (#1654): sanitizedAiResponseMessage.text is the FULL DM turn,
          // which by contract ends with lettered/numbered action options the player never
          // chose. Feeding that straight into extractMemories caused option text (e.g.
          // "Rush to the kitchen, follow his order...") to be stored as story memories,
          // polluting later DM context. Strip the options first via the same helper the
          // UI uses to render the narrative, and only extract if narrative remains.
          const narrativeOnly = parseMessageOptions(sanitizedAiResponseMessage.text).content;
          if (narrativeOnly) {
            logger.info('[Memory Flow] Extracting memories from AI response:', narrativeOnly);
            await extractMemories(narrativeOnly); // Non-critical path
          }
        }
      }
    } catch (error) {
      handleAsyncError(error, {
        userMessage: 'Failed to process your message',
        context: {
          location: 'MessageHandler.actualSendMessage',
          playerInput,
          turnCount: turnCountRef.current,
        },
      });

      // Provide user feedback and recovery options
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      const combatIntentFailure = error instanceof CombatIntentRefusedError && !error.isRepairable;
      const recoveryMessage = combatIntentFailure
        ? 'The server could not complete that combat action. Please try again.'
        : 'I encountered an issue processing your message. Let me try again, or you can rephrase your action if needed.';

      // Add a system error message to the conversation
      try {
        const systemErrorMessage: ChatMessage = {
          text: recoveryMessage,
          sender: 'system',
          context: {
            intent: 'error_recovery',
            originalError: errorMessage,
          },
        };
        await sendMessage(systemErrorMessage);
      } catch (systemMessageError) {
        handleAsyncError(systemMessageError, {
          userMessage: 'Failed to send error recovery message',
          logLevel: 'warn',
          showToast: false,
          context: { location: 'MessageHandler.errorRecovery' },
        });
      }

      // Revert turn count if AI response failed (use original value from when error occurred)
      try {
        const revertCount = Math.max(0, turnCountRef.current - 1);
        await updateGameSessionState((prev: ExtendedGameSession) => ({
          ...prev,
          turn_count: Math.max(0, (prev.turn_count || 0) - 1),
        }));
        turnCountRef.current = revertCount;
      } catch (revertError) {
        handleAsyncError(revertError, {
          userMessage: 'Failed to revert turn count',
          logLevel: 'warn',
          showToast: false,
          context: { location: 'MessageHandler.revertTurnCount' },
        });
      }

      toast({
        title: combatIntentFailure ? 'Combat action failed' : 'Processing Error',
        description: combatIntentFailure
          ? recoveryMessage
          : 'I had trouble responding to your message. The conversation has been restored and you can try again.',
        variant: 'destructive',
      });
    }
  };

  // Keep the ref current so processSendQueue always dispatches to the latest closure.
  // Synchronous assignment (not useEffect) ensures it's updated before any render-triggered call.
  actualSendMessageRef.current = actualSendMessage;

  return {
    handleSendMessage,
    isProcessing: queueStatus === 'processing' || isSendingRef.current,
  };
};
