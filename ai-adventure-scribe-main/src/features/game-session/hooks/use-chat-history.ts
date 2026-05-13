import { useCallback, useEffect, useRef, useState } from 'react';

import { useChatPersistence } from './use-chat-persistence';

import type { ChatMessage, GameContext, NarrationSegment } from '@/services/ai-service';

import logger from '@/lib/logger';
import { AIService } from '@/services/ai-service';
import { handleAsyncError } from '@/utils/error-handler';

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
  const {
    messages,
    setMessages,
    isLoadingHistory,
    hasLoadedHistory,
    setHasLoadedHistory,
    saveMessageToDatabase,
    fetchHistory,
  } = useChatPersistence(sessionId);

  const messagesRef = useRef(messages);
  const [isSending, setIsSending] = useState(false);
  const isSendingRef = useRef(isSending);

  // ⚡ Bolt: Keep refs in sync with state to stabilize callback identities.
  // This prevents mass re-renders in the chat UI when messages are sent or received.
  useEffect(() => {
    messagesRef.current = messages;
    isSendingRef.current = isSending;
  }, [messages, isSending]);

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
    setMessages,
  ]);

  /**
   * Load conversation history
   */
  const loadHistory = useCallback(async () => {
    if (!sessionId || hasLoadedHistory) return;

    const history = await fetchHistory();

    if (history === null) {
      // Error occurred, but we already handled it with handleAsyncError
      // Fallback to generating opening message
      await generateOpeningMessage();
      setHasLoadedHistory(true);
      return;
    }

    if (history.length > 0) {
      setMessages(history);
      setHasLoadedHistory(true);
    } else {
      logger.info('📚 No message history found, generating opening message');
      // If no messages exist, generate an opening message
      await generateOpeningMessage();
      setHasLoadedHistory(true);
    }
  }, [sessionId, hasLoadedHistory, fetchHistory, generateOpeningMessage, setMessages, setHasLoadedHistory]);

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
      const isAlreadySending = isSendingRef.current;
      const currentMessages = messagesRef.current;

      if (!sessionId || isAlreadySending) return;

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

      const updatedMessages = [...currentMessages, userMessage];
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
        setMessages(currentMessages);
      } finally {
        setIsSending(false);
      }
    },
    [
      sessionId,
      campaignId,
      characterId,
      campaignDetails,
      characterDetails,
      saveMessageToDatabase,
      onMessageReceived,
      setMessages,
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
