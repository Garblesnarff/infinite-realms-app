// SDK Imports
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useCallback, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';

// Project Imports
import type { ChatMessage } from '@/types/game';

import { useToast } from '@/hooks/use-toast'; // Assuming kebab-case
import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000;
const MAX_BATCH_SIZE = 5;

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
          const contextData = message.context
            ? {
                location: message.context.location || null,
                emotion: message.context.emotion || null,
                intent: message.context.intent || null,
                handouts: message.context.handouts || null,
                combat_transition: message.context.combat_transition || null,
                scene_spec: Boolean(message.context.scene_spec),
              }
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

          // Process any queued messages if this one succeeded
          if (messageQueue.length > 0) {
            const batch = messageQueue.slice(0, MAX_BATCH_SIZE);
            await processMessageBatch(batch);
            setMessageQueue((prev) => prev.slice(MAX_BATCH_SIZE));
          }

          setQueueStatus('idle');
          return persistedMessage;
        } catch (error) {
          logger.error(`Attempt ${retries + 1} failed:`, error);
          retries++;

          if (retries === MAX_RETRIES) {
            setQueueStatus('error');
            // Queue message for later retry if max retries reached
            setMessageQueue((prev) => [...prev, message]);
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

      toast({
        title: 'Error',
        description: 'Message will be retried automatically',
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
      const formattedBatch = batch.map((message) => ({
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
            }
          : {},
        timestamp: message.timestamp || now,
      }));

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
    }),
    [messageMutation, queueStatus, messageQueue.length, retryQueuedMessages],
  );
};
