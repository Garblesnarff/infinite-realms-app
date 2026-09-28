import React from 'react';

import type { MessageSendContext } from '../../chat/MessageList';

import logger from '@/lib/logger';

interface QueueItem {
  message: string;
  context?: MessageSendContext;
  /** The caller's promise, handed to an identical send instead of a second turn. */
  settled: Promise<void>;
  resolve: (value: void | PromiseLike<void>) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  reject: (error: any) => void;
}

/**
 * Custom hook to extract the message send-queue management logic.
 *
 * This hook maintains a FIFO request queue to prevent concurrent message sends,
 * and maintains synchronous actualSendMessage ref alignment for session continuity.
 */
export const useMessageSendQueue = (): {
  handleSendMessage: (playerInput: string, context?: MessageSendContext) => Promise<void>;
  isSending: boolean;
  isSendingRef: React.MutableRefObject<boolean>;
  actualSendMessageRef: React.MutableRefObject<
    (input: string, ctx?: MessageSendContext) => Promise<void>
  >;
} => {
  // Request queue to prevent concurrent message sends
  const sendQueueRef = React.useRef<QueueItem[]>([]);
  const isSendingRef = React.useRef(false);
  const [isSending, setIsSending] = React.useState(false);

  // Ref keeps processSendQueue pointed at the latest actualSendMessage closure,
  // preventing stale sessionId / extractMemories captures when the session changes.
  const actualSendMessageRef = React.useRef<
    (input: string, ctx?: MessageSendContext) => Promise<void>
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
    setIsSending(true);
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
      setIsSending(false);

      // Process next item if any
      if (sendQueueRef.current.length > 0) {
        // Recursively process next message
        processSendQueue();
      }
    }
  }, []); // stable — actualSendMessageRef.current is always the latest closure

  // Public handleSendMessage that queues messages
  const handleSendMessage = React.useCallback(
    async (playerInput: string, context?: MessageSendContext): Promise<void> => {
      // A byte-identical send while the first is still waiting or in flight is the same turn
      // arriving twice, not a second turn (#2305). Run M7: a second click on the sheet's Cast
      // queued "I cast Chill Touch [...]" behind round 1, and it played as round 2's player turn
      // after the player had stopped acting. Every item is either waiting or in flight, so a
      // later, deliberate repeat — the same cantrip next round — is never collapsed.
      const contextKey = JSON.stringify(context ?? null);
      const duplicate = sendQueueRef.current.find(
        (item) =>
          item.message === playerInput && JSON.stringify(item.context ?? null) === contextKey,
      );
      if (duplicate) {
        logger.warn('DUPLICATE_PLAYER_TURN_DROPPED', {
          intent: context?.intent ?? 'typed',
          queued: sendQueueRef.current.length,
        });
        return duplicate.settled;
      }
      let resolveItem!: QueueItem['resolve'];
      let rejectItem!: QueueItem['reject'];
      const settled = new Promise<void>((resolve, reject) => {
        resolveItem = resolve;
        rejectItem = reject;
      });
      // Add to queue with optional context (for dice roll results)
      sendQueueRef.current.push({
        message: playerInput,
        context,
        settled,
        resolve: resolveItem,
        reject: rejectItem,
      });

      // Start processing if not already processing
      processSendQueue();
      return settled;
    },
    [processSendQueue],
  );

  return {
    handleSendMessage,
    isSending,
    isSendingRef,
    actualSendMessageRef,
  };
};
