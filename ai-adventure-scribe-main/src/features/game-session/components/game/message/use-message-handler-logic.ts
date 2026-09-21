import React from 'react';

import { useMessageCommandHandler } from './use-message-command-handler';
import { useMessageSendQueue } from './use-message-send-queue';
import { useSessionValidator } from '../session/SessionValidator';

import type { ExtendedGameSession, SessionStateUpdater } from '../../../types/session';
import type { MessageSendContext } from '../../chat/MessageList';
import type { ChatMessage } from '@/types/game';

import { useCharacter } from '@/contexts/CharacterContext';
import { useGame } from '@/contexts/GameContext';
import { useMemoryContext } from '@/contexts/MemoryContext';
import { useMessageContext } from '@/contexts/MessageContext';
import {
  INITIAL_COMBAT_TURN_UI_STATE,
  logCombatTurnUiState,
  type CombatTurnUiState,
} from '@/hooks/ai/combat-turn-preflight';
import { useAIResponse } from '@/hooks/use-ai-response';
import { useToast } from '@/hooks/use-toast';
import {
  createTurnPhaseReporter,
  SESSION_EXPIRED_MESSAGE,
  SessionExpiredError,
} from '@/infrastructure/api/rest-client';
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
const DEFERRED_TASK_TIMEOUT_MS = 20_000;

function runDeferredTask(label: string, task: () => Promise<unknown>): void {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`${label} timed out after ${DEFERRED_TASK_TIMEOUT_MS}ms`)),
      DEFERRED_TASK_TIMEOUT_MS,
    );
  });

  void Promise.race([Promise.resolve().then(task), timeout])
    .catch((error) => logger.error(`[MessageHandler] Deferred ${label} failed:`, error))
    .finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    });
}

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
  handleSendMessage: (playerInput: string, context?: MessageSendContext) => Promise<void>;
  isProcessing: boolean;
  combatTurnUiState: CombatTurnUiState;
  resumeCombatTurn: () => Promise<void>;
} => {
  const { messages, sendMessage } = useMessageContext();
  const { extractMemories } = useMemoryContext();
  const {
    getAIResponse,
    combatTurnUiState = INITIAL_COMBAT_TURN_UI_STATE,
    resumeCombatTurn = async () => {},
  } = useAIResponse();
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
  const { handleSendMessage, isSending, actualSendMessageRef } = useMessageSendQueue();

  // Refs to track current values for async operations
  const turnCountRef = React.useRef(turnCount);
  const messagesRef = React.useRef(messages);
  const turnPhaseRef = React.useRef<ReturnType<typeof createTurnPhaseReporter> | null>(null);
  const wasSendingRef = React.useRef(false);
  const [composerBlocked, setComposerBlockedState] = React.useState(false);
  const composerBlockedRef = React.useRef(false);

  const setComposerBlocked = React.useCallback((blocked: boolean) => {
    composerBlockedRef.current = blocked;
    setComposerBlockedState(blocked);
    if (!blocked) {
      turnPhaseRef.current?.('composer enabled');
      turnPhaseRef.current = null;
    }
  }, []);

  // Update refs when values change
  React.useEffect(() => {
    turnCountRef.current = turnCount;
  }, [turnCount]);

  React.useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  React.useEffect(() => {
    if (wasSendingRef.current && !isSending && !composerBlockedRef.current) {
      turnPhaseRef.current?.('composer enabled');
      turnPhaseRef.current = null;
    }
    wasSendingRef.current = isSending;
  }, [isSending]);

  // Assuming validateSession is still relevant or adapted
  const validateSession = useSessionValidator({ sessionId, campaignId, characterId });

  // The actual message sending logic (extracted from handleSendMessage)
  const actualSendMessage = async (
    playerInput: string,
    providedContext?: MessageSendContext,
  ): Promise<void> => {
    const turnPhase = createTurnPhaseReporter();
    turnPhaseRef.current = turnPhase;
    setComposerBlocked(true);
    turnPhase('submit');
    let turnCountAdvanced = false;
    let textShown = false;
    let earlyMessage: ChatMessage | null = null;
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
      let diceRollPending = false;
      let combatPreflightPending = false;
      const diceCommandResult = await handleDiceCommand(playerInput, async (earlyResponse) => {
        diceRollPending = Boolean(earlyResponse.rollRequests?.length);
        combatPreflightPending = Boolean(
          diceRollPending ||
          earlyResponse.combatDetection?.shouldStartCombat ||
          earlyResponse.context?.combat_transition === 'start',
        );
        turnPhase('text shown');
        runDeferredTask('dice DM message persistence', () => sendMessage(earlyResponse));
        setComposerBlocked(combatPreflightPending);
        if (!combatPreflightPending) setComposerBlocked(false);
      });
      if (diceCommandResult.isDiceCommand) {
        if (!combatPreflightPending) setComposerBlocked(false);
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
      turnCountAdvanced = true;

      // Update the ref to reflect the new turn count
      turnCountRef.current = newTurnCount;

      // Optional: System acknowledgment (can be removed if AI response is fast)
      // const systemMessage: ChatMessage = { text: "Processing...", sender: 'system', context: { intent: 'acknowledgment' } };
      // await sendMessage(systemMessage);

      logger.info('[Memory Flow] Getting AI response for session:', sessionId);
      // Pass necessary context to getAIResponse. It fetches its own campaign/char details if needed.
      // Use ref to get current messages to avoid stale closure
      const aiResponseMessage = await getAIResponse(
        [...messagesRef.current, playerMessage],
        sessionId,
        undefined,
        turnPhase,
        async (earlyResponse) => {
          const hasEarlyRollRequests = Boolean(earlyResponse.rollRequests?.length);
          const combatGatePending = Boolean(
            hasEarlyRollRequests ||
            earlyResponse.combatDetection?.shouldStartCombat ||
            earlyResponse.context?.combat_transition === 'start',
          );
          const earlyText = hasEarlyRollRequests
            ? truncateAtRollRequest(sanitizeDMText(earlyResponse.text))
            : sanitizeDMText(earlyResponse.text);

          earlyMessage = { ...earlyResponse, text: earlyText };
          textShown = Boolean(earlyText || earlyResponse.narrationSegments?.length);
          if (textShown) {
            // MessageQueue is optimistic: the message enters the rendered cache before its
            // persistence request resolves. Mark the render boundary before any critical action
            // handling and let the persistence failure be logged independently.
            turnPhase('text shown');
            setComposerBlocked(combatGatePending);
            runDeferredTask('DM message persistence', () => sendMessage(earlyMessage!));

            if (providedContext?.intent !== 'dice_roll') {
              runDeferredTask('player memory extraction', () => extractMemories(playerInput));
            }

            const narrativeOnly = parseMessageOptions(earlyText).content;
            if (narrativeOnly) {
              runDeferredTask('AI response memory extraction', () =>
                extractMemories(narrativeOnly),
              );
            }

            if (earlyText) {
              const blurb = headerMode === 'off' ? '' : toHeaderExcerpt(earlyText);
              runDeferredTask('scene-state persistence', () =>
                updateGameSessionState((prev: ExtendedGameSession) => ({
                  ...prev,
                  current_scene_description: blurb,
                })),
              );
            }
          }
        },
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
        runDeferredTask('local notice persistence', () =>
          sendMessage({
            text: notice.text,
            sender: 'system',
            timestamp: new Date().toISOString(),
            persist: notice.persist,
            context: { intent: 'combat_pending_intent' },
          }),
        );
      }

      // The early callback normally rendered the parsed envelope. Combat resolution may replace
      // the text with authoritative engine narration; persist that continuation only when it
      // differs, so the initial DM response is visible while the gate runs.
      if (
        (!textShown || (earlyMessage && sanitizedAiResponseMessage.text !== earlyMessage.text)) &&
        (sanitizedAiResponseMessage.text || sanitizedAiResponseMessage.narrationSegments?.length)
      ) {
        if (!textShown) {
          turnPhase('text shown');
          setComposerBlocked(
            Boolean(hasRollRequests || sanitizedAiResponseMessage.combatDetection?.isCombat),
          );
        }
        runDeferredTask('DM continuation persistence', () =>
          sendMessage(sanitizedAiResponseMessage),
        );
      }

      if (hasRollRequests) {
        processAiResponse(sanitizedAiResponseMessage.rollRequests || []);
      }

      if (
        !hasRollRequests &&
        !sanitizedAiResponseMessage.combatDetection?.shouldStartCombat &&
        sanitizedAiResponseMessage.context?.combat_transition !== 'start'
      ) {
        setComposerBlocked(false);
      }

      // Combat detection still runs after the first render; roll-request turns already have their
      // critical gate handled above and do not need a second transcript callback here.
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
          // The parsed response callback already scheduled scene persistence and narrative
          // extraction. Keep the fallback for callers/tests that do not provide onTextReady.
          if (!textShown) {
            if (providedContext?.intent !== 'dice_roll') {
              runDeferredTask('player memory extraction', () => extractMemories(playerInput));
            }
            const blurb =
              headerMode === 'off' ? '' : toHeaderExcerpt(sanitizedAiResponseMessage.text);
            runDeferredTask('scene-state persistence', () =>
              updateGameSessionState((prev: ExtendedGameSession) => ({
                ...prev,
                current_scene_description: blurb,
              })),
            );
            const narrativeOnly = parseMessageOptions(sanitizedAiResponseMessage.text).content;
            if (narrativeOnly) {
              runDeferredTask('AI response memory extraction', () =>
                extractMemories(narrativeOnly),
              );
            }
          }
        }
      }
    } catch (error) {
      const sessionExpired =
        error instanceof SessionExpiredError ||
        (typeof error === 'object' &&
          error !== null &&
          (error as { status?: unknown }).status === 401);
      handleAsyncError(error, {
        userMessage: sessionExpired ? SESSION_EXPIRED_MESSAGE : 'Failed to process your message',
        showToast: false,
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
      if (!sessionExpired) {
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
      }

      // Revert turn count if AI response failed (use original value from when error occurred)
      if (turnCountAdvanced) {
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
      }

      toast({
        title: sessionExpired
          ? 'Session expired'
          : combatIntentFailure
            ? 'Combat action failed'
            : 'Processing Error',
        description: sessionExpired
          ? SESSION_EXPIRED_MESSAGE
          : combatIntentFailure
            ? recoveryMessage
            : 'I had trouble responding to your message. The conversation has been restored and you can try again.',
        variant: 'destructive',
      });

      // Let ChatInput retain the pending text for retry, while the send queue's
      // finally block clears its sending state and unlocks the composer.
      throw error;
    }
  };

  // Keep the ref current so processSendQueue always dispatches to the latest closure.
  // Synchronous assignment (not useEffect) ensures it's updated before any render-triggered call.
  actualSendMessageRef.current = actualSendMessage;

  React.useEffect(() => {
    logCombatTurnUiState({ ...combatTurnUiState, isSending });
  }, [combatTurnUiState, isSending]);

  return {
    handleSendMessage,
    isProcessing: isSending && composerBlocked,
    combatTurnUiState,
    resumeCombatTurn,
  };
};
