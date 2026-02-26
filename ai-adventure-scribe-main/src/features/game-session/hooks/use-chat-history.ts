import { useState, useCallback, useEffect } from 'react';

import type { ChatMessage, GameContext, NarrationSegment } from '@/services/ai-service';

import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';
import { AIService } from '@/services/ai-service';
import { handleAsyncError } from '@/utils/error-handler';

interface DialogueHistoryRow {
  id: string;
  speaker_type: string;
  message: string;
  timestamp: string;
}

interface UseChatHistoryParams {
  sessionId: string | undefined;
  campaignId: string;
  characterId: string;
  campaignDetails?: Record<string, unknown>;
  characterDetails?: Record<string, unknown>;
  onMessageReceived?: (response: unknown) => void;
}

/**
 * Custom hook to manage chat history and message sending logic.
 * Extracted from SimpleGameChatWithVoice.tsx for better maintainability.
 */
export const useChatHistory = ({
  sessionId,
  campaignId,
  characterId,
  campaignDetails,
  characterDetails,
  onMessageReceived,
}: UseChatHistoryParams): {
  messages: ChatMessage[];
  isSending: boolean;
  isLoadingHistory: boolean;
  hasLoadedHistory: boolean;
  sendMessage: (message: ChatMessage | string) => Promise<void>;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
} => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [hasLoadedHistory, setHasLoadedHistory] = useState(false);

  /**
   * Wait for a message to exist in the database with retry logic
   * Handles potential transaction commit delays in distributed databases
   */
  const waitForMessageToExist = useCallback(
    async (messageId: string, maxRetries = 5, initialDelay = 100): Promise<boolean> => {
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        const { data, error } = await supabase
          .from('dialogue_history')
          .select('id')
          .eq('id', messageId)
          .maybeSingle();

        if (!error && data) {
          logger.debug(`[useChatHistory] ✅ Message verified in database after ${attempt} retries`);
          return true;
        }

        if (attempt < maxRetries - 1) {
          const delay = initialDelay * Math.pow(2, attempt); // Exponential backoff
          logger.debug(
            `[useChatHistory] ⏳ Message not found, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      logger.error(`[useChatHistory] ❌ Message verification failed after ${maxRetries} retries`);
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
      logger.debug('[useChatHistory] Saving message to database:', {
        messageId: message.id,
        sessionId: sid,
        timestamp: new Date().toISOString(),
      });

      try {
        const { error } = await supabase.from('dialogue_history').insert({
          id: message.id,
          session_id: sid,
          speaker_type:
            message.role === 'assistant' ? 'dm' : message.role === 'user' ? 'player' : 'system',
          message: message.content,
          timestamp: message.timestamp.toISOString(),
        });

        if (error) {
          logger.error('[useChatHistory] ❌ Database insert FAILED:', { error });
          throw error;
        }

        logger.debug('[useChatHistory] Database insert promise resolved, verifying...');

        // Verify the message actually exists in the database
        const verified = await waitForMessageToExist(message.id);

        if (!verified) {
          logger.error('[useChatHistory] ❌ Message verification failed');
          return false;
        }

        logger.debug('[useChatHistory] ✅ Message saved and verified:', { messageId: message.id });
        return true;
      } catch (error) {
        logger.error('[useChatHistory] Exception during save:', { error });
        handleAsyncError(error, {
          userMessage: 'Failed to save message',
          logLevel: 'warn',
          showToast: false,
          context: { location: 'useChatHistory.saveMessageToDatabase', sessionId: sid },
        });
        // Don't throw here to avoid breaking the UI flow
        return false;
      }
    },
    [waitForMessageToExist],
  );

  /**
   * Generate an opening message for a new session
   */
  const generateOpeningMessage = useCallback(async () => {
    if (!sessionId) return;

    try {
      const context: GameContext = {
        sessionId,
        campaignId,
        characterId,
        campaignDetails,
        characterDetails,
      };

      logger.info('🎭 Generating opening message for new session...');
      const response = await AIService.chatWithDM({
        message: '',
        context,
        conversationHistory: [],
      });

      if (response) {
        // Validate response structure and ensure proper display text
        let displayText = '';
        let segments = undefined;

        if (typeof response === 'string') {
          displayText = response;
        } else if (response && typeof response === 'object') {
          // Cast to any to handle the dynamic AI service response structure
          const aiResponse = response as Record<string, unknown>;
          displayText = (aiResponse.text as string) || (aiResponse.content as string) || '';
          // AI service returns 'narration_segments' (snake_case)
          segments = (aiResponse.narration_segments ||
            aiResponse.narrationSegments) as NarrationSegment[];
        }

        // Fallback if no valid text found
        if (!displayText.trim()) {
          displayText = 'The DM begins your adventure...';
          logger.warn('⚠️ Empty response text, using fallback');
        }

        const dmMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: displayText,
          timestamp: new Date(),
          narrationSegments: segments as NarrationSegment[],
        };

        // Save opening message to database FIRST before adding to state
        await saveMessageToDatabase(dmMessage, sessionId);

        // Now add to state to trigger UI update
        setMessages([dmMessage]);

        // Trigger callback for additional processing (like NPC rolls)
        if (onMessageReceived) {
          onMessageReceived(response);
        }
      }
    } catch (error) {
      handleAsyncError(error, {
        userMessage: 'Failed to start adventure. Please try again.',
        context: {
          location: 'useChatHistory.generateOpeningMessage',
          sessionId,
        },
      });
    }
  }, [
    sessionId,
    campaignId,
    characterId,
    campaignDetails,
    characterDetails,
    saveMessageToDatabase,
    onMessageReceived,
  ]);

  /**
   * Load conversation history
   */
  const loadHistory = useCallback(async () => {
    if (!sessionId || hasLoadedHistory) return;

    setIsLoadingHistory(true);
    try {
      logger.info('📚 Loading conversation history for session:', sessionId);

      // Load message history from dialogue_history table
      const { data: historyData, error: historyError } = await supabase
        .from('dialogue_history')
        .select('*')
        .eq('session_id', sessionId)
        .order('sequence_number', { ascending: true });

      if (historyError) {
        logger.error('Error loading history:', historyError);
        throw historyError;
      }

      if (historyData && historyData.length > 0) {
        logger.info(`📚 Loaded ${historyData.length} messages from history`);

        // Convert database messages to ChatMessage format
        const loadedMessages: ChatMessage[] = (historyData as unknown as DialogueHistoryRow[]).map(
          (msg) => ({
            id: msg.id,
            role:
              msg.speaker_type === 'dm'
                ? 'assistant'
                : msg.speaker_type === 'player'
                  ? 'user'
                  : 'assistant',
            content: msg.message,
            timestamp: new Date(msg.timestamp),
            // Note: Historical messages may not have narrationSegments
            narrationSegments: undefined,
          }),
        );

        setMessages(loadedMessages);
        setHasLoadedHistory(true);
      } else {
        logger.info('📚 No message history found, generating opening message');
        // If no messages exist, generate an opening message
        await generateOpeningMessage();
        setHasLoadedHistory(true);
      }
    } catch (error) {
      handleAsyncError(error, {
        userMessage: 'Failed to load history',
        logLevel: 'warn',
        showToast: false,
        context: { location: 'useChatHistory.loadHistory', sessionId },
      });
      // Fallback to generating opening message if history loading fails
      await generateOpeningMessage();
      setHasLoadedHistory(true);
    } finally {
      setIsLoadingHistory(false);
    }
  }, [sessionId, hasLoadedHistory, generateOpeningMessage]);

  // Load history when session is available and we haven't loaded it yet
  useEffect(() => {
    if (sessionId && !hasLoadedHistory && !isLoadingHistory) {
      loadHistory();
    }
  }, [sessionId, hasLoadedHistory, isLoadingHistory, loadHistory]);

  /**
   * Send message to DM
   */
  const sendMessage = useCallback(
    async (message: ChatMessage | string): Promise<void> => {
      if (!sessionId || isSending) return;

      const messageContent = typeof message === 'string' ? message : message.content;
      if (!messageContent.trim()) return;

      setIsSending(true);

      // Add user message immediately
      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: messageContent,
        timestamp: new Date(),
      };

      const updatedMessages = [...messages, userMessage];
      setMessages(updatedMessages);

      // Save user message to database
      const saved = await saveMessageToDatabase(userMessage, sessionId);
      if (!saved) {
        logger.warn('[useChatHistory] User message not saved, but continuing for UI resilience');
      }

      try {
        const context: GameContext = {
          sessionId,
          campaignId,
          characterId,
          campaignDetails,
          characterDetails,
        };

        logger.info('🎭 Sending message to DM:', messageContent);
        const response = await AIService.chatWithDM({
          message: messageContent,
          context,
          conversationHistory: updatedMessages,
        });

        if (response) {
          // Validate response structure and ensure proper display text
          let displayText = '';
          let segments = undefined;

          if (typeof response === 'string') {
            displayText = response;
          } else if (response && typeof response === 'object') {
            // Cast to any to handle the dynamic AI service response structure
            const aiResponse = response as Record<string, unknown>;
            displayText = (aiResponse.text as string) || (aiResponse.content as string) || '';
            // AI service returns 'narration_segments' (snake_case)
            segments = (aiResponse.narration_segments ||
              aiResponse.narrationSegments) as NarrationSegment[];
          }

          // Fallback if no valid text found
          if (!displayText.trim()) {
            displayText = 'The DM responds to your action...';
            logger.warn('⚠️ Empty response text, using fallback');
          }

          const dmMessage: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: displayText,
            timestamp: new Date(),
            narrationSegments: segments as NarrationSegment[],
          };

          // Save DM message to database FIRST before adding to state
          const saved = await saveMessageToDatabase(dmMessage, sessionId);

          if (!saved) {
            logger.warn('[useChatHistory] DM message not saved, skipping state update');
            return; // Don't add to state if save failed
          }

          // Now add to state to trigger UI update
          setMessages((prev) => [...prev, dmMessage]);

          // Trigger callback for additional processing (like NPC rolls)
          if (onMessageReceived) {
            onMessageReceived(response);
          }
        }
      } catch (error) {
        handleAsyncError(error, {
          userMessage: 'Failed to send message. Please try again.',
          context: {
            location: 'useChatHistory.sendMessage',
            sessionId,
            messageContent: messageContent.substring(0, 50),
          },
        });

        // Restore messages on failure
        setMessages(messages);
      } finally {
        setIsSending(false);
      }
    },
    [
      sessionId,
      messages,
      isSending,
      campaignId,
      characterId,
      campaignDetails,
      characterDetails,
      saveMessageToDatabase,
      onMessageReceived,
    ],
  );

  return {
    messages,
    isSending,
    isLoadingHistory,
    hasLoadedHistory,
    sendMessage,
    setMessages,
  };
};
