import { useState, useCallback } from 'react';

import type { ChatMessage } from '@/services/ai-service';

import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';
import { handleAsyncError } from '@/utils/error-handler';

interface DialogueHistoryRow {
  id: string;
  speaker_type: string;
  message: string;
  timestamp: string;
}

/**
 * Custom hook to manage chat history persistence with Supabase.
 * Extracted from use-chat-history.ts for better separation of concerns.
 */
export const useChatPersistence = (
  sessionId: string | undefined,
): {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  isLoadingHistory: boolean;
  hasLoadedHistory: boolean;
  setHasLoadedHistory: React.Dispatch<React.SetStateAction<boolean>>;
  saveMessageToDatabase: (message: ChatMessage, sid: string) => Promise<boolean>;
  fetchHistory: () => Promise<ChatMessage[] | null>;
} => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [hasLoadedHistory, setHasLoadedHistory] = useState(false);

  /**
   * Wait for a message to exist in the database with retry logic
   * Handles potential transaction commit delays in distributed databases
   */
  const waitForMessageToExist = useCallback(
    async (messageId: string, maxRetries = 5, initialDelay = 100): Promise<boolean> => {
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        if (await userDataApi.sessionMessageExists(sessionId!, messageId)) {
          logger.debug(
            `[useChatPersistence] ✅ Message verified in database after ${attempt} retries`,
          );
          return true;
        }

        if (attempt < maxRetries - 1) {
          const delay = initialDelay * Math.pow(2, attempt); // Exponential backoff
          logger.debug(
            `[useChatPersistence] ⏳ Message not found, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      logger.error(
        `[useChatPersistence] ❌ Message verification failed after ${maxRetries} retries`,
      );
      return false;
    },
    [],
  );

  /**
   * Save a message to the database
   * Returns true if save and verification succeeded, false otherwise
   */
  const saveMessageToDatabase = useCallback(
    async (message: ChatMessage, sid: string): Promise<boolean> => {
      logger.debug('[useChatPersistence] Saving message to database:', {
        messageId: message.id,
        sessionId: sid,
        timestamp: new Date().toISOString(),
      });

      try {
        await userDataApi.saveSessionMessages(sid, {
          id: message.id,
          speaker_type:
            message.role === 'assistant' ? 'dm' : message.role === 'user' ? 'player' : 'system',
          message: message.content,
          timestamp: message.timestamp.toISOString(),
        });

        logger.debug('[useChatPersistence] Database insert promise resolved, verifying...');

        // Verify the message actually exists in the database
        const verified = await waitForMessageToExist(message.id);

        if (!verified) {
          logger.error('[useChatPersistence] ❌ Message verification failed');
          return false;
        }

        logger.debug('[useChatPersistence] ✅ Message saved and verified:', {
          messageId: message.id,
        });
        return true;
      } catch (error) {
        logger.error('[useChatPersistence] Exception during save:', { error });
        handleAsyncError(error, {
          userMessage: 'Failed to save message',
          logLevel: 'warn',
          showToast: false,
          context: { location: 'useChatPersistence.saveMessageToDatabase', sessionId: sid },
        });
        // Don't throw here to avoid breaking the UI flow
        return false;
      }
    },
    [waitForMessageToExist],
  );

  /**
   * Fetch conversation history from Supabase
   */
  const fetchHistory = useCallback(async (): Promise<ChatMessage[] | null> => {
    if (!sessionId) return null;

    setIsLoadingHistory(true);
    try {
      logger.info('📚 Loading conversation history for session:', sessionId);

      // Load message history from dialogue_history table
      // ⚡ Bolt: Optimized to use explicit columns instead of select('*') to reduce over-fetching
      // of the heavy JSONB 'context' column which is not displayed in the chat history.
      const { messages: historyData } = await userDataApi.listSessionMessages(sessionId, 0, 200);

      if (historyData && historyData.length > 0) {
        logger.info(`📚 Loaded ${historyData.length} messages from history`);

        // Convert database messages to ChatMessage format
        return (historyData as unknown as DialogueHistoryRow[]).map((msg) => ({
          id: msg.id,
          role:
            msg.speaker_type === 'dm'
              ? 'assistant'
              : msg.speaker_type === 'player'
                ? 'user'
                : 'assistant',
          content: msg.message,
          timestamp: new Date(msg.timestamp),
          narrationSegments: undefined,
        }));
      }

      return [];
    } catch (error) {
      handleAsyncError(error, {
        userMessage: 'Failed to load history',
        logLevel: 'warn',
        showToast: false,
        context: { location: 'useChatPersistence.fetchHistory', sessionId },
      });
      return null;
    } finally {
      setIsLoadingHistory(false);
    }
  }, [sessionId]);

  return {
    messages,
    setMessages,
    isLoadingHistory,
    hasLoadedHistory,
    setHasLoadedHistory,
    saveMessageToDatabase,
    fetchHistory,
  };
};
