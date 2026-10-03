// SDK Imports
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useCallback, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';

// Project Imports
import type { ChatMessage } from '@/types/game';

import { useToast } from '@/hooks/use-toast'; // Assuming kebab-case
import { isNetworkError, SessionExpiredError } from '@/infrastructure/api/rest-client';
import logger from '@/lib/logger';
import { isTerminalDefeatError, userDataApi } from '@/services/user-data-api';
import { persistableNarrationSegments } from '@/utils/narration-segments';

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000;
const MAX_BATCH_SIZE = 5;

function isSessionExpiredError(error: unknown): boolean {
  return (
    error instanceof SessionExpiredError ||
    (typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 401)
  );
}

/**
 * The server refused the request itself (a 4xx other than an expired session): sending the same
 * body again gets the same answer, so it is neither retried nor queued (#2280).
 */
function isClientRefusal(error: unknown): boolean {
  const status =
    typeof error === 'object' && error !== null ? (error as { status?: unknown }).status : null;
  return (
    typeof status === 'number' &&
    status >= 400 &&
    status < 500 &&
    status !== 401 &&
    status !== 408 &&
    status !== 429
  );
}

type QueueStatus = 'idle' | 'processing' | 'error' | 'retrying';

/**
 * Hook for managing message queue and persistence with enhanced error handling
 * @param sessionId Current game session ID
 */
export const useMessageQueue = (sessionId: string | null) => {
  const [queueStatus, setQueueStatus] = useState<QueueStatus>('idle');
  const [messageQueue, setMessageQueue] = useState<ChatMessage[]>([]);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  /**
   * Render a message without persisting it: inserts it into the rendered message cache when it
   * is not there yet, and replaces it in place when it is.
   *
   * This is the render half of `messageMutation` on its own. It exists so a turn can show DM
   * text immediately while the authoritative text is still being resolved, and then persist
   * exactly once — `dialogue_history` never receives an early draft that the UI later replaced
   * (#2139). Callers that want the row saved must still call `sendMessage`.
   */
  const updateMessage = useCallback(
    (updatedMessage: ChatMessage): void => {
      if (!sessionId || !updatedMessage.id) return;

      const messageQueries = queryClient.getQueryCache().findAll({
        queryKey: ['messages', sessionId],
      });
      messageQueries.forEach((query) => {
        queryClient.setQueryData(
          query.queryKey,
          (old: { messages: ChatMessage[]; hasMore: boolean } | undefined) => {
            if (!old?.messages) return old;
            const exists = old.messages.some((message) => message.id === updatedMessage.id);
            return {
              ...old,
              messages: exists
                ? old.messages.map((message) =>
                    message.id === updatedMessage.id ? updatedMessage : message,
                  )
                : [...old.messages, updatedMessage],
            };
          },
        );
      });
    },
    [queryClient, sessionId],
  );

  /**
   * Handles message persistence with enhanced retry logic and backoff
   * Generates message IDs on the frontend to avoid race conditions with database replication
   */
  const messageMutation = useMutation({
    onMutate: async (newMessage: ChatMessage) => {
      if (!sessionId) return;

      // Cancel any outgoing refetches (so they don't overwrite our optimistic update)
      await queryClient.cancelQueries({ queryKey: ['messages', sessionId] });

      // Snapshot the previous value for all pages to allow rollback
      const queryCache = queryClient.getQueryCache();
      const queryKeys = queryCache.findAll({ queryKey: ['messages', sessionId] });
      const previousData = queryKeys.map((query) => ({
        queryKey: query.queryKey,
        data: query.state.data,
      }));

      // ⚡ Bolt: Optimistically update the cache for all active message pages.
      // This ensures the message appears instantly regardless of which page is currently active.
      queryKeys.forEach((query) => {
        queryClient.setQueryData(query.queryKey, (old: { messages: ChatMessage[] } | undefined) => {
          if (!old || !old.messages) return old;
          // Check if message already exists
          if (old.messages.some((m: ChatMessage) => m.id === newMessage.id)) return old;
          return {
            ...old,
            messages: [...old.messages, newMessage],
          };
        });
      });

      return { previousData };
    },
    mutationFn: async (message: ChatMessage) => {
      if (!sessionId) throw new Error('Session ID is required to save a message');
      let retries = 0;
      let delay = INITIAL_RETRY_DELAY;

      // Generate message ID on frontend if not provided to avoid database timing issues
      const messageId = message.id || uuidv4();
      const now = message.timestamp || new Date().toISOString();

      // Some engine notices are already persisted by the authoritative server operation that
      // produced them. Keep them in the optimistic UI and refetch on success, but never insert a
      // second dialogue_history row from the client.
      if (message.persist === false) {
        setQueueStatus('idle');
        return {
          ...message,
          id: messageId,
          timestamp: now,
        };
      }

      while (retries < MAX_RETRIES) {
        try {
          setQueueStatus(retries > 0 ? 'retrying' : 'processing');

          // Format the context to ensure it's compatible with Supabase's Json type
          const narrationSegments = persistableNarrationSegments(message);
          const rollRequests = message.rollRequests ?? message.context?.rollRequests;
          const contextData = message.context
            ? {
                location: message.context.location || null,
                emotion: message.context.emotion || null,
                intent: message.context.intent || null,
                handouts: message.context.handouts || null,
                combat_transition: message.context.combat_transition || null,
                scene_spec: Boolean(message.context.scene_spec),
                combat_engine_blocks:
                  message.context.combatEngineBlocks ??
                  message.context.combat_engine_blocks ??
                  null,
                combat_ended: Boolean(message.context.combatEnded ?? message.context.combat_ended),
                narration_segments: narrationSegments,
                ...(Array.isArray(rollRequests) ? { rollRequests } : {}),
                ...(message.context.initialGreeting === true ? { initial_greeting: true } : {}),
                ...(message.context.previouslyOn === true ? { previously_on: true } : {}),
                ...(Array.isArray(message.context.engineCards)
                  ? { engineCards: message.context.engineCards }
                  : {}),
              }
            : narrationSegments
              ? {
                  narration_segments: narrationSegments,
                  ...(Array.isArray(rollRequests) ? { rollRequests } : {}),
                }
              : Array.isArray(rollRequests)
                ? { rollRequests }
                : {};

          await userDataApi.saveSessionMessages(sessionId, {
            id: messageId,
            message: message.text,
            speaker_type: message.sender,
            context: contextData,
            timestamp: now,
          });

          // Return the message with the ID we generated (available immediately, no race condition)
          const persistedMessage: ChatMessage = {
            ...message,
            id: messageId,
            timestamp: now,
          };

          logger.info(`[MessageQueue] Message persisted with ID: ${messageId}`);

          // Flush earlier failures now that saving works, but never as part of this save: on M5
          // a queued row the server would always refuse failed every later save through here,
          // the player's roll included, and the roll could not be submitted (#2280).
          if (messageQueue.length > 0) {
            const batch = messageQueue.slice(0, MAX_BATCH_SIZE);
            processMessageBatch(batch)
              .then(() =>
                setMessageQueue((prev) => prev.filter((queued) => !batch.includes(queued))),
              )
              .catch((batchError) =>
                logger.warn('[MessageQueue] Queued messages still not saved', {
                  count: batch.length,
                  error: batchError,
                }),
              );
          }

          setQueueStatus('idle');
          return persistedMessage;
        } catch (error) {
          logger.error(`Attempt ${retries + 1} failed:`, error);
          retries++;
          const networkError = isNetworkError(error);

          const refused = isClientRefusal(error);
          if (retries === MAX_RETRIES || isSessionExpiredError(error) || networkError || refused) {
            setQueueStatus('error');
            // The REST client owns the bounded network retry. Keep the turn in the composer
            // instead of retrying the same persistence request again from this queue. A request
            // the server refused (4xx) will be refused again, so it is not queued either. Anything
            // queued keeps the id it was tried with, so a later flush cannot duplicate the row.
            if (!networkError && !refused) {
              setMessageQueue((prev) => [...prev, { ...message, id: messageId, timestamp: now }]);
            }
            throw error;
          }

          // Exponential backoff
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2; // Double the delay for next retry
        }
      }
      throw new Error('Message persistence retries exhausted');
    },
    onError: (error, _variables, context) => {
      logger.error('Error saving message:', error);

      // ⚡ Bolt: Rollback to the previous state on error to maintain data integrity.
      if (context?.previousData) {
        context.previousData.forEach((item) => {
          queryClient.setQueryData(item.queryKey, item.data);
        });
      }

      // #2517: the fallen-character refusal is not an error to report —
      // the death screen replaces the game, and the send handler restores
      // it. A "server refused" toast on top of the end state would be the
      // generic error the round-1 fix review forbade.
      if (isTerminalDefeatError(error)) {
        return;
      }

      toast({
        title: 'Error',
        description: isNetworkError(error)
          ? 'Your turn is still in the composer so you can resend it.'
          : isClientRefusal(error)
            ? 'The server refused to save this message.'
            : 'Message will be retried automatically',
        variant: 'destructive',
      });
    },
    onSuccess: () => {
      // ⚡ Bolt: Invalidate and refetch messages to ensure cache is up-to-date and sync with DB sequence numbers.
      queryClient.invalidateQueries({ queryKey: ['messages', sessionId] });
    },
  });

  /**
   * Process a batch of queued messages
   * Also generates IDs for each message to ensure they're immediately available
   */
  const processMessageBatch = useCallback(
    async (batch: ChatMessage[]) => {
      if (!sessionId) throw new Error('Session ID is required to save messages');
      const now = new Date().toISOString();
      const formattedBatch = batch.map((message) => {
        const narrationSegments = persistableNarrationSegments(message);
        const rollRequests = message.rollRequests ?? message.context?.rollRequests;
        return {
          id: message.id || uuidv4(),
          message: message.text,
          speaker_type: message.sender,
          context: message.context
            ? {
                location: message.context.location || null,
                emotion: message.context.emotion || null,
                intent: message.context.intent || null,
                handouts: message.context.handouts || null,
                combat_transition: message.context.combat_transition || null,
                scene_spec: Boolean(message.context.scene_spec),
                combat_engine_blocks:
                  message.context.combatEngineBlocks ??
                  message.context.combat_engine_blocks ??
                  null,
                combat_ended: Boolean(message.context.combatEnded ?? message.context.combat_ended),
                narration_segments: narrationSegments,
                ...(Array.isArray(rollRequests) ? { rollRequests } : {}),
                ...(message.context.initialGreeting === true ? { initial_greeting: true } : {}),
                ...(message.context.previouslyOn === true ? { previously_on: true } : {}),
                ...(Array.isArray(message.context.engineCards)
                  ? { engineCards: message.context.engineCards }
                  : {}),
              }
            : narrationSegments
              ? {
                  narration_segments: narrationSegments,
                  ...(Array.isArray(rollRequests) ? { rollRequests } : {}),
                }
              : Array.isArray(rollRequests)
                ? { rollRequests }
                : {},
          timestamp: message.timestamp || now,
        };
      });

      await userDataApi.saveSessionMessages(sessionId, formattedBatch);
    },
    [sessionId],
  );

  /**
   * Retry all queued messages
   */
  const retryQueuedMessages = useCallback(async () => {
    if (messageQueue.length > 0 && queueStatus !== 'processing') {
      try {
        const batch = messageQueue.slice(0, MAX_BATCH_SIZE);
        await processMessageBatch(batch);
        setMessageQueue((prev) => prev.slice(MAX_BATCH_SIZE));

        if (messageQueue.length > 0) {
          // Schedule next batch
          setTimeout(retryQueuedMessages, INITIAL_RETRY_DELAY);
        }
      } catch (error) {
        logger.error('Error processing message batch:', error);
        toast({
          title: 'Error',
          description: 'Failed to process message batch. Will retry later.',
          variant: 'destructive',
        });
      }
    }
  }, [messageQueue, queueStatus, processMessageBatch, toast]);

  return useMemo(
    () => ({
      messageMutation,
      queueStatus,
      queueLength: messageQueue.length,
      retryQueuedMessages,
      updateMessage,
    }),
    [messageMutation, queueStatus, messageQueue.length, retryQueuedMessages, updateMessage],
  );
};
