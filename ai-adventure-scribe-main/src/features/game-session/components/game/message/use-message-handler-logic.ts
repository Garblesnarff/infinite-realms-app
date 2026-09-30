import React from 'react';

import { toHeaderExcerpt } from './scene-blurb';
import { useHeldEntryRecovery } from './use-held-entry-recovery';
import { useMessageCommandHandler } from './use-message-command-handler';
import { useMessageSendQueue } from './use-message-send-queue';
import { useSessionValidator } from '../session/SessionValidator';

import type { ExtendedGameSession, SessionStateUpdater } from '../../../types/session';
import type { MessageSendContext } from '../../chat/MessageList';
import type { LocalNotice } from '@/hooks/ai/types';
import type { ChatMessage } from '@/types/game';
import type { RollRequest } from '@/types/roll-request';

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
  isNetworkError,
  SESSION_EXPIRED_MESSAGE,
  SessionExpiredError,
  subscribeToNetworkRetry,
} from '@/infrastructure/api/rest-client';
import logger from '@/lib/logger';
import { CombatIntentRefusedError } from '@/services/combat/combat-action-executor';
import { sanitizeDMText } from '@/utils/chatSanitizer';
import { stripEngineGeneratedLines } from '@/utils/engine-lines';
import { handleAsyncError } from '@/utils/error-handler';
import { parseMessageOptions } from '@/utils/parseMessageOptions';
import { isNarrativeRollRequest } from '@/utils/roll-request/engine-channel';

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
const headerMode = String(import.meta.env.VITE_SCENE_SUMMARY_HEADER ?? 'short').toLowerCase();
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

/**
 * The saved form of a DM reply that asked for narrative rolls (#2280): the reply itself, under
 * this turn's id, with the requests in its context. It always has text; a model reply with no
 * prose gets one line naming the rolls, so the row is valid and still readable after the roll.
 */
export function rollReplyMessage(
  reply: ChatMessage,
  dmMessageId: string,
  rollRequests: RollRequest[],
): ChatMessage {
  const text =
    reply.text.trim() ||
    `The DM asks for a roll: ${rollRequests.map((request) => request.purpose).join('; ')}.`;
  return {
    ...reply,
    id: dmMessageId,
    text,
    sender: 'dm',
    rollRequests,
    context: { ...reply.context, rollRequests },
  };
}

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
  isReconnecting: boolean;
  combatTurnUiState: CombatTurnUiState;
  resumeCombatTurn: () => Promise<void>;
} => {
  const { messages, messagesReady, sendMessage, updateMessage } = useMessageContext();
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
  const [isReconnecting, setIsReconnecting] = React.useState(false);

  React.useEffect(() => subscribeToNetworkRetry(setIsReconnecting), []);

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

  // The client's save of a DM reply. A failure used to be a logger line: the queue rolled the
  // optimistic row back off the screen and nothing retried it (#2218). The reply now stays
  // visible and the player gets a retry. The save is idempotent by message id, and the server
  // replaces its own provisional copy of the turn in place, so a retry never writes a second row.
  const persistDmReply = async (message: ChatMessage, onPersisted?: () => void): Promise<void> => {
    try {
      await sendMessage(message);
      onPersisted?.();
    } catch (error) {
      logger.error('[MessageHandler] DM reply save failed; offering a retry', {
        messageId: message.id,
        error,
      });
      // Only a reply with prose is worth a retry, and only prose may go back on screen: putting
      // a text-less row back into the cache blanked the visible reply on M5 (#2280).
      if (!message.text.trim()) return;
      updateMessage(message);
      toast({
        title: "The DM's reply wasn't saved",
        description: 'It is still on screen. Retry to keep it in your story.',
        variant: 'destructive',
        duration: Infinity,
        action: {
          label: 'Retry',
          onClick: () => void persistDmReply(message, onPersisted),
        },
      });
    }
  };

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
    let rollTurnStarted = false;
    let textPhaseEmitted = false;
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
        runDeferredTask('dice DM message persistence', async () => {
          await sendMessage(earlyResponse);
          turnPhase('persist');
        });
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
      // #2341: a resumed turn answers a message that is already saved and already counted.
      const resumingSavedMessage = providedContext?.intent === 'resume_unanswered';
      const savedMessage = currentMessages[currentMessages.length - 1];

      // Add player message
      // CRITICAL FIX: Use provided context if available (for dice roll results)
      // This preserves the 'dice_roll' intent through the message flow,
      // enabling the roll suppression logic in use-ai-response.ts
      const playerMessage: ChatMessage =
        resumingSavedMessage && savedMessage
          ? savedMessage
          : {
              text: playerInput,
              sender: 'player',
              characterName: character?.name,
              characterAvatar: character?.avatar_url,
              context: providedContext ?? {
                intent: isFirstMessage ? 'first_action' : 'query',
                isFirstMessage,
              },
            };
      if (!resumingSavedMessage) {
        await sendMessage(playerMessage); // This adds to UI and saves to dialogue_history

        // Update turn count immediately after player message is sent using functional form
        await updateGameSessionState((prev: ExtendedGameSession) => ({
          ...prev,
          turn_count: (prev.turn_count || 0) + 1,
        }));
        turnCountAdvanced = true;

        // Update the ref to reflect the new turn count
        turnCountRef.current = newTurnCount;
      }

      // Optional: System acknowledgment (can be removed if AI response is fast)
      // const systemMessage: ChatMessage = { text: "Processing...", sender: 'system', context: { intent: 'acknowledgment' } };
      // await sendMessage(systemMessage);

      logger.info('[Memory Flow] Getting AI response for session:', sessionId);
      // #2218: one id for this turn's DM row, reserved before generation. The server persists a
      // display-ready reply under it, and the early render and the final save below reuse it,
      // so the turn is one row whichever side writes it and a dead tab cannot lose the reply.
      const dmMessageId = crypto.randomUUID();
      const showEngineNotice = (notice: LocalNotice): void => {
        runDeferredTask('local notice persistence', () =>
          sendMessage({
            text: notice.text,
            sender: 'system',
            timestamp: new Date().toISOString(),
            persist: notice.persist,
            context: { intent: 'combat_pending_intent' },
          }),
        );
      };
      // Pass necessary context to getAIResponse. It fetches its own campaign/char details if needed.
      // Use ref to get current messages to avoid stale closure
      const aiResponseMessage = await getAIResponse(
        [
          ...(resumingSavedMessage ? messagesRef.current.slice(0, -1) : messagesRef.current),
          playerMessage,
        ],
        sessionId,
        undefined,
        turnPhase,
        async (earlyResponse, textReadyOptions) => {
          const hasEarlyRollRequests = Boolean(earlyResponse.rollRequests?.length);
          const combatGatePending = Boolean(
            hasEarlyRollRequests ||
            earlyResponse.combatDetection?.shouldStartCombat ||
            earlyResponse.context?.combat_transition === 'start',
          );

          // `use-ai-response` always supplies this. The fallback keeps a structured roll
          // request suppressed even for a caller that does not pass render guidance.
          const suppressRender = textReadyOptions?.suppressRender ?? hasEarlyRollRequests;

          if (suppressRender) {
            // The engine may resolve this turn before the final narration exists — a roll
            // request, combat entry, or any in-combat turn (`requestPlayerAttackRoll` runs
            // inside `handleDmActionsAndTransitions`, after this callback). Declaration-turn
            // prose can describe a hit or miss the dice have not decided yet, so nothing is
            // rendered here; the composer stays blocked until resolution.
            // A narrative roll turn outside combat may show its prompt immediately — the
            // structured request is the authoritative UI boundary there. A combat-start or
            // in-combat turn may not: those `roll_requests` are the DM's engine declaration
            // channel, `dm-actions-handler` strips `attack`/`initiative` once the encounter is
            // seated, and prompting with the raw list steals the single visible dice slot from
            // the engine's own initiative prompt (#2190). Those turns wait for the final,
            // filtered list. The type filter is defence in depth: no engine-channel request is
            // ever forwarded from here, whatever the flag says.
            const earlyPromptRollRequests = textReadyOptions?.earlyRollPromptAllowed
              ? (earlyResponse.rollRequests ?? []).filter(isNarrativeRollRequest)
              : [];
            if (earlyPromptRollRequests.length > 0) {
              rollTurnStarted = true;
              turnPhase('text shown');
              textPhaseEmitted = true;
              processAiResponse(earlyPromptRollRequests);
            } else if (hasEarlyRollRequests) {
              logger.info('[RollPrompt] early roll prompt withheld for an engine-resolved turn', {
                requestTypes: (earlyResponse.rollRequests ?? []).map((request) => request.type),
                inCombatTurn: !textReadyOptions?.earlyRollPromptAllowed,
              });
            }
            return;
          }

          const earlyText = sanitizeDMText(earlyResponse.text);

          earlyMessage = {
            ...earlyResponse,
            id: dmMessageId,
            text: earlyText,
          };
          textShown = Boolean(earlyText || earlyResponse.narrationSegments?.length);
          if (textShown) {
            // Render-only: the row enters the message cache but is NOT persisted here. The
            // final authoritative text is saved once below, so dialogue_history never keeps an
            // early draft that the UI has already replaced (#2139).
            turnPhase('text shown');
            textPhaseEmitted = true;
            setComposerBlocked(combatGatePending);
            updateMessage(earlyMessage);

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
                  // An engine-only reply leaves no scene text: keep the previous description.
                  current_scene_description:
                    blurb || headerMode === 'off' ? blurb : prev.current_scene_description,
                })),
              );
            }
          }
        },
        dmMessageId,
        showEngineNotice,
      );
      // Sanitize the AI response text first
      const processedText = sanitizeDMText(aiResponseMessage.text);

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

      // Same boundary as the early path: `attack` and `initiative` entries are the DM's engine
      // declaration channel and the engine prompts for those dice itself. `dm-actions-handler`
      // strips them on combat entry, but an in-combat turn that is not an entry turn does not go
      // through that filter, so the raw list can still carry one (#2190 / #2200). Every gate
      // below reads the filtered list: a turn whose only requests are engine-channel ones is a
      // resolved turn, and must show its narration, unblock the composer and reach
      // `onAIResponse` like any other. Counting the raw list there withheld the text, queued no
      // popup, skipped combat detection and never released the composer block. An engine prompt the player still owes cannot reach
      // this point: `requestPlayerAttackRoll` is awaited inside `handleDmActionsAndTransitions`,
      // so the composer stays blocked from submit until that roll settles.
      const rawRollRequests = sanitizedAiResponseMessage.rollRequests ?? [];
      const narrativeRollRequests = rawRollRequests.filter(isNarrativeRollRequest);
      const hasRollRequests = narrativeRollRequests.length > 0;
      if (rawRollRequests.length > narrativeRollRequests.length) {
        logger.info('[RollPrompt] final roll prompt withheld engine-channel requests', {
          requestTypes: rawRollRequests.map((request) => request.type),
        });
      }

      // Engine-authored notices may have different persistence owners. The seating transcript
      // is already written by the server's `/enter` endpoint, while decline/failure/no-host and
      // queued-intent notices still belong in the client message history.
      const localNotices =
        aiResponseMessage.localNotices ??
        (aiResponseMessage.localNotice
          ? [{ text: aiResponseMessage.localNotice, persist: true }]
          : []);
      for (const notice of localNotices) showEngineNotice(notice);

      // A roll is still pending: the player has not rolled, so no narration may be shown or
      // saved for this turn. Everything else renders — including a turn whose early render was
      // suppressed and which the engine has since resolved, so the resolved narration can never
      // be eaten by the sticky `rollTurnStarted` flag.
      if (
        !hasRollRequests &&
        (sanitizedAiResponseMessage.text || sanitizedAiResponseMessage.narrationSegments?.length)
      ) {
        const finalMessage: ChatMessage = earlyMessage
          ? {
              ...sanitizedAiResponseMessage,
              id: earlyMessage.id,
              timestamp: earlyMessage.timestamp,
            }
          : { ...sanitizedAiResponseMessage, id: dmMessageId };

        if (!textPhaseEmitted) {
          turnPhase('text shown');
          textPhaseEmitted = true;
        }
        if (!textShown) {
          setComposerBlocked(Boolean(sanitizedAiResponseMessage.combatDetection?.isCombat));
        } else if (earlyMessage) {
          // The early response is already the visible DM row. Replace that row in place so
          // engine-authored final narration cannot append a duplicate paragraph/message.
          updateMessage(finalMessage);
        }

        // The single persistence point for DM narration on this turn. The early render is
        // cache-only, so dialogue_history receives the authoritative text exactly once.
        runDeferredTask('DM continuation persistence', () =>
          persistDmReply(finalMessage, () => turnPhase('persist')),
        );
      }

      if (hasRollRequests && !rollTurnStarted) {
        processAiResponse(narrativeRollRequests);
      }

      if (
        !hasRollRequests &&
        !sanitizedAiResponseMessage.combatDetection?.shouldStartCombat &&
        sanitizedAiResponseMessage.context?.combat_transition !== 'start'
      ) {
        setComposerBlocked(false);
      }

      if (hasRollRequests) {
        // One row per DM reply (#2280). The reply's prose and its narrative roll requests are
        // saved together under this turn's id, so a reload can restore the popup from the same
        // row. The message list withholds this row's prose until the roll is answered
        // (`withheldDmRollReplies`), so neither a live tab nor a reload shows an outcome the player
        // has not rolled. The old separate textless row under this id failed the route's
        // `minLength: 1` on every narrative roll (422) and poisoned the save queue.
        runDeferredTask('DM roll reply persistence', () =>
          persistDmReply(
            rollReplyMessage(sanitizedAiResponseMessage, dmMessageId, narrativeRollRequests),
            () => turnPhase('persist'),
          ),
        );
      }

      // Combat detection still runs after the first render; turns still waiting on a roll have
      // their critical gate handled above and do not need a second transcript callback here.
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
                // An engine-only reply leaves no scene text: keep the previous description.
                current_scene_description:
                  blurb || headerMode === 'off' ? blurb : prev.current_scene_description,
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
      const networkError = isNetworkError(error);
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
      if (!sessionExpired && !networkError) {
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

  useHeldEntryRecovery({
    sessionId,
    messages,
    messagesReady,
    characterRecord: character as Record<string, unknown> | null | undefined,
    resumeTurn: (playerInput) => handleSendMessage(playerInput, { intent: 'resume_unanswered' }),
  });

  React.useEffect(() => {
    logCombatTurnUiState({ ...combatTurnUiState, isSending });
  }, [combatTurnUiState, isSending]);

  const isProcessing = isSending && composerBlocked;

  return {
    handleSendMessage,
    isProcessing,
    isReconnecting: isProcessing && isReconnecting,
    combatTurnUiState,
    resumeCombatTurn,
  };
};
