import React from 'react';

import type { MessageSendContext } from '../../chat/MessageList';

interface QueueItem {
  message: string;
  context?: MessageSendContext;
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
    isSending,
    isSendingRef,
    actualSendMessageRef,
  };
};
