import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import type { ChatMessage, GameContext } from '@/services/ai-service';
import type { GameSession } from '@/types/game';

import { useSimpleGameSession } from '@/hooks/use-simple-game-session';
import logger from '@/lib/logger';
import { AIService } from '@/services/ai-service';
import { handleAsyncError } from '@/utils/error-handler';

interface UseSimpleChatLogicProps {
  campaignId: string;
  characterId: string;
  campaignDetails?: unknown;
  characterDetails?: unknown;
}

/**
 * Hook to manage simple chat logic for game sessions
 * Extracted from SimpleGameChat.tsx
 */
export const useSimpleChatLogic = ({
  campaignId,
  characterId,
  campaignDetails,
  characterDetails,
}: UseSimpleChatLogicProps): {
  session: GameSession | null;
  sessionLoading: boolean;
  messages: ChatMessage[];
  currentMessage: string;
  setCurrentMessage: React.Dispatch<React.SetStateAction<string>>;
  isSending: boolean;
  isLoadingHistory: boolean;
  streamingMessage: string;
  messagesEndRef: React.RefObject<HTMLDivElement>;
  handleEndSession: () => Promise<void>;
  sendMessage: (e?: React.SyntheticEvent) => Promise<void>;
  handleKeyPress: (e: React.KeyboardEvent) => void;
  handleOptionSelect: (option: string) => void;
  handleOptionDoubleClick: (option: string) => void;
} => {
  const {
    session,
    loading: sessionLoading,
    endSession,
  } = useSimpleGameSession(campaignId, characterId);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesRef = useRef(messages);
  const [currentMessage, setCurrentMessage] = useState('');
  const currentMessageRef = useRef(currentMessage);
  const [isSending, setIsSending] = useState(false);
  const isSendingRef = useRef(isSending);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // ⚡ Bolt: Keep refs in sync with state for use in callbacks without dependency churn.
  // This allows sendMessage to have a stable identity throughout the session.
  useEffect(() => {
    currentMessageRef.current = currentMessage;
    messagesRef.current = messages;
    isSendingRef.current = isSending;
  }, [currentMessage, messages, isSending]);

  // Scroll to bottom when messages change
  const scrollToBottom = useCallback((): void => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  /**
   * Generate an opening message for a new session
   */
  const generateOpeningMessage = useCallback(async (): Promise<void> => {
    if (!session?.id) {
      return;
    }

    try {
      const context: GameContext = {
        campaignId,
        characterId,
        sessionId: session.id,
        starterCampaignId: session.starter_campaign_id ?? undefined,
        campaignDetails,
        characterDetails,
      };

      // Generate the opening message
      const openingContent = await AIService.generateOpeningMessage({ context });

      // Create the DM message
      const dmMessage: ChatMessage = {
        id: `dm-opening-${Date.now()}`,
        role: 'assistant',
        content: openingContent,
        timestamp: new Date(),
      };

      // Save to database
      await AIService.saveChatMessage({
        sessionId: session.id,
        role: 'assistant',
        content: openingContent,
      });

      // Add to UI
      setMessages([dmMessage]);

      logger.info('Opening message generated and saved');
    } catch (error) {
      handleAsyncError(error, {
        userMessage: 'Failed to generate opening message',
        context: { location: 'SimpleGameChat.generateOpeningMessage', sessionId: session.id },
      });
    }
  }, [
    session?.id,
    session?.starter_campaign_id,
    campaignId,
    characterId,
    campaignDetails,
    characterDetails,
  ]);

  const loadConversationHistory = useCallback(async (): Promise<void> => {
    if (!session?.id) {
      return;
    }

    setIsLoadingHistory(true);
    try {
      const history = await AIService.getConversationHistory(session.id);
      setMessages(history);

      // If this is a new session with no messages, generate an opening message
      if (history.length === 0) {
        await generateOpeningMessage();
      }
    } catch (error) {
      handleAsyncError(error, {
        userMessage: 'Failed to load conversation history',
        context: { location: 'SimpleGameChat.loadConversationHistory', sessionId: session.id },
      });
    } finally {
      setIsLoadingHistory(false);
    }
  }, [session?.id, generateOpeningMessage]);

  // Load conversation history when session is available
  useEffect(() => {
    if (session?.id) {
      loadConversationHistory();
    }
  }, [session?.id, loadConversationHistory]);

  /**
   * Handle ending the current session
   */
  const handleEndSession = async (): Promise<void> => {
    if (!session?.id) {
      return;
    }

    try {
      // Generate a session summary based on the conversation
      const conversationSummary =
        messages.length > 0
          ? `Session concluded with ${messages.length} messages exchanged.`
          : 'Session ended without gameplay.';

      await endSession(session.id, conversationSummary);

      toast.success('Session ended successfully!', {
        description: 'Your progress has been saved.',
      });

      // Navigate back to campaign page
      navigate(`/campaign/${campaignId}`);
    } catch (error) {
      handleAsyncError(error, {
        userMessage: 'Failed to end session properly',
        context: { location: 'SimpleGameChat.handleEndSession', sessionId: session.id, campaignId },
      });
    }
  };

  const sendMessage = useCallback(
    async (e?: React.SyntheticEvent): Promise<void> => {
      if (e) {
        e.preventDefault();
      }

      // ⚡ Bolt: Use refs for high-frequency state to keep callback identity stable.
      // This prevents O(N) re-renders of the entire chat list when sending or receiving messages.
      const messageContent = currentMessageRef.current.trim();
      const currentMessages = messagesRef.current;
      const isAlreadySending = isSendingRef.current;

      if (!messageContent || !session?.id || isAlreadySending) {
        return;
      }

      const userMessage: ChatMessage = {
        id: `temp-${Date.now()}`,
        role: 'user',
        content: messageContent,
        timestamp: new Date(),
      };

      // Add user message to UI immediately
      setMessages((prev) => [...prev, userMessage]);
      setCurrentMessage('');
      setIsSending(true);

      try {
        // Save user message to database
        await AIService.saveChatMessage({
          sessionId: session.id,
          role: 'user',
          content: userMessage.content,
          speakerId: characterId,
        });

        // Get AI response with streaming
        const context: GameContext = {
          campaignId,
          characterId,
          sessionId: session.id,
          starterCampaignId: session.starter_campaign_id ?? undefined,
          campaignDetails,
          characterDetails,
        };

        setStreamingMessage(''); // Reset streaming message

        const aiResponse = await AIService.chatWithDM({
          message: userMessage.content,
          context,
          conversationHistory: currentMessages,
          onStream: (chunk: string) => {
            setStreamingMessage((prev) => prev + chunk);
          },
        });

        // Save AI response to database
        await AIService.saveChatMessage({
          sessionId: session.id,
          role: 'assistant',
          content: aiResponse,
        });

        // Add AI response to UI
        const assistantMessage: ChatMessage = {
          id: `ai-${Date.now()}`,
          role: 'assistant',
          content: aiResponse,
          timestamp: new Date(),
        };

        setMessages((prev) => [...prev, assistantMessage]);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        // Determine user-friendly message based on error type
        let userMsg = 'Failed to send message. Please try again.';
        let description: string | undefined;

        if (errorMessage.includes('Rate limit exceeded')) {
          userMsg = 'Rate limit exceeded. Please wait before sending another message.';
          description =
            "You've hit the daily or per-minute API limit. Check the API Stats for details.";
        } else if (errorMessage.includes('all AI services unavailable')) {
          userMsg = 'AI services are currently unavailable';
          description = 'Both Edge Functions and local API failed. Please try again later.';
        }

        handleAsyncError(error, {
          userMessage: userMsg,
          context: {
            location: 'SimpleGameChat.sendMessage',
            sessionId: session.id,
            messageContent: userMessage.content.substring(0, 50),
          },
          onError: () => {
            // Show custom description if needed
            if (description) {
              toast.error(userMsg, { description, duration: 5000 });
            }
          },
        });

        // Remove the user message from UI on error
        setMessages((prev) => prev.filter((msg) => msg.id !== userMessage.id));
      } finally {
        setStreamingMessage(''); // Clear streaming message
        setIsSending(false);
      }
    },
    [
      campaignId,
      session?.id,
      session?.starter_campaign_id,
      characterId,
      campaignDetails,
      characterDetails,
    ],
  );

  const handleKeyPress = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleOptionSelect = useCallback((option: string) => {
    setCurrentMessage(option);
  }, []);

  const handleOptionDoubleClick = useCallback(
    (option: string) => {
      setCurrentMessage(option);
      // Brief timeout to ensure state update is processed if needed
      setTimeout(() => {
        sendMessage();
      }, 80);
    },
    [sendMessage],
  );

  return {
    session,
    sessionLoading,
    messages,
    currentMessage,
    setCurrentMessage,
    isSending,
    isLoadingHistory,
    streamingMessage,
    messagesEndRef,
    handleEndSession,
    sendMessage,
    handleKeyPress,
    handleOptionSelect,
    handleOptionDoubleClick,
  };
};
