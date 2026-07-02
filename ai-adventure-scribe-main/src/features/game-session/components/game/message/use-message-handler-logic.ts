import React from 'react';

import { useMessageCommandHandler } from './use-message-command-handler';
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
import { sanitizeDMText } from '@/utils/chatSanitizer';
import { handleAsyncError } from '@/utils/error-handler';
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

  // Refs to track current values for async operations
  const turnCountRef = React.useRef(turnCount);
  const messagesRef = React.useRef(messages);

  // Request queue to prevent concurrent message sends
  const sendQueueRef = React.useRef<
    Array<{
      message: string;
      context?: DiceRollContext;
      resolve: (value: void | PromiseLike<void>) => void;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      reject: (error: any) => void;
    }>
  >([]);
  const isSendingRef = React.useRef(false);

  // Update refs when values change
  React.useEffect(() => {
    turnCountRef.current = turnCount;
  }, [turnCount]);

  React.useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Assuming validateSession is still relevant or adapted
  const validateSession = useSessionValidator({ sessionId, campaignId, characterId });

  // Ref keeps processSendQueue pointed at the latest actualSendMessage closure,
  // preventing stale sessionId / extractMemories captures when the session changes.
  const actualSendMessageRef = React.useRef<
    (input: string, ctx?: DiceRollContext) => Promise<void>
  >(async () => {
    /* populated after actualSendMessage is defined */
  });

  // Process the send queue one message at a time
  const processSendQueue = React.useCallback(async () => {
    // Don't process if already sending or queue is empty
    if (isSendingRef.current || sendQueueRef.current.length === 0) {
      return;
    }

    isSendingRef.current = true;
    const { message: playerInput, context, resolve, reject } = sendQueueRef.current[0];

    try {
      await actualSendMessageRef.current(playerInput, context);
      resolve();
    } catch (error) {
      reject(error);
    } finally {
      // Remove processed item and continue with next
      sendQueueRef.current.shift();
      isSendingRef.current = false;

      // Process next item if any
      if (sendQueueRef.current.length > 0) {
        // Recursively process next message
        processSendQueue();
      }
    }
  }, []); // stable — actualSendMessageRef.current is always the latest closure

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
        await sendMessage(sanitizedAiResponseMessage);
      }

      // Only process combat detection, voice, scene updates, and memories
      // when the message is actually displayed (not when suppressed for roll requests)
      if (!hasRollRequests) {
        // Process AI response for combat detection and other features
        if (onAIResponse) {
          try {
            logger.info('[Combat Flow] Processing AI response for combat detection');
            await onAIResponse(sanitizedAiResponseMessage);
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
          logger.info(
            '[Memory Flow] Extracting memories from AI response:',
            sanitizedAiResponseMessage.text,
          );
          await extractMemories(sanitizedAiResponseMessage.text); // Non-critical path
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

      // Add a system error message to the conversation
      try {
        const systemErrorMessage: ChatMessage = {
          text: 'I encountered an issue processing your message. Let me try again, or you can rephrase your action if needed.',
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
        title: 'Processing Error',
        description:
          'I had trouble responding to your message. The conversation has been restored and you can try again.',
        variant: 'destructive',
      });
    }
  };

  // Keep the ref current so processSendQueue always dispatches to the latest closure.
  // Synchronous assignment (not useEffect) ensures it's updated before any render-triggered call.
  actualSendMessageRef.current = actualSendMessage;

  // Public handleSendMessage that queues messages
  const handleSendMessage = React.useCallback(
    async (playerInput: string, context?: DiceRollContext): Promise<void> => {
      return new Promise<void>((resolve, reject) => {
        // Add to queue with optional context (for dice roll results)
        sendQueueRef.current.push({
          message: playerInput,
          context,
          resolve,
          reject,
        });

        // Start processing if not already processing
        processSendQueue();
      });
    },
    [processSendQueue],
  );

  return {
    handleSendMessage,
    isProcessing: queueStatus === 'processing' || isSendingRef.current,
  };
};
