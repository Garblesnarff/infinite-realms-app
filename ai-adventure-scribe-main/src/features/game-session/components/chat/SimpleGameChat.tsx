import { Send, LogOut, Loader2 } from 'lucide-react';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { SimpleMessageList } from './SimpleMessageList';

import type { ChatMessage, GameContext } from '@/services/ai-service';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useSimpleGameSession } from '@/hooks/use-simple-game-session';
import logger from '@/lib/logger';
import { AIService } from '@/services/ai-service';
import { handleAsyncError } from '@/utils/error-handler';

interface SimpleGameChatProps {
  campaignId: string;
  characterId: string;
  campaignDetails?: unknown;
  characterDetails?: unknown;
}

export const SimpleGameChat: React.FC<SimpleGameChatProps> = ({
  campaignId,
  characterId,
  campaignDetails,
  characterDetails,
}) => {
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

  // ⚡ Bolt: Keep refs in sync with state for use in callbacks without dependency churn.
  // This allows sendMessage to have a stable identity throughout the session.
  useEffect(() => {
    currentMessageRef.current = currentMessage;
    messagesRef.current = messages;
    isSendingRef.current = isSending;
  }, [currentMessage, messages, isSending]);
  const navigate = useNavigate();

  // Scroll to bottom when messages change
  const scrollToBottom = (): void => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

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

  if (sessionLoading) {
    return (
      <Card className="h-full">
        <CardContent className="flex items-center justify-center h-96">
          <div className="flex flex-col items-center space-y-2">
            <span className="animate-spin">
              <Loader2 className="h-8 w-8" />
            </span>
            <p className="text-muted-foreground">Setting up your adventure...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full flex flex-col parchment">
      <CardHeader className="parchment-panel">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span>Adventure Chat</span>
            {session && (
              <span className="text-sm font-normal text-muted-foreground">
                Session #{session.session_number}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const stats = AIService.getApiStats();
                logger.info('API Stats:', stats);

                const rateLimits = (stats as unknown as { rateLimits: { remainingDaily: number; dailyLimit: number; remainingMinutely: number; minutelyLimit: number } }).rateLimits;
                if (rateLimits) {
                  toast.success('API Stats', {
                    description: `Daily: ${rateLimits.remainingDaily}/${rateLimits.dailyLimit} | Minute: ${rateLimits.remainingMinutely}/${rateLimits.minutelyLimit}`,
                    duration: 4000,
                  });
                } else {
                  toast.success('API stats logged to console');
                }
              }}
            >
              API Stats
            </Button>
            <Button size="sm" variant="destructive" onClick={handleEndSession} disabled={isSending}>
              <LogOut className="w-4 h-4 mr-2" />
              End Session
            </Button>
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col p-0">
        <div className="parchment-panel flex-1 overflow-hidden">
          <SimpleMessageList
            messages={messages}
            isSending={isSending}
            isLoadingHistory={isLoadingHistory}
            streamingMessage={streamingMessage}
            onOptionSelect={handleOptionSelect}
            onOptionDoubleClick={handleOptionDoubleClick}
            messagesEndRef={messagesEndRef}
          />
        </div>

        <div className="border-t p-4 chat-composer">
          <form onSubmit={(e) => sendMessage(e)} className="flex space-x-2 items-center">
            <Input
              aria-label="Chat input"
              value={currentMessage}
              onChange={(e) => setCurrentMessage(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Describe your action or intent..."
              disabled={isSending || !session}
              className="flex-1 bg-transparent"
            />
            <Button
              type="submit"
              disabled={!currentMessage.trim() || isSending || !session}
              className="px-3"
              aria-label="Send message"
            >
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </CardContent>
    </Card>
  );
};
