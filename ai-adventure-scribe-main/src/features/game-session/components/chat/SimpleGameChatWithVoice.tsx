/**
 * SimpleGameChatWithVoice Component
 *
 * Wrapper that provides voice capabilities to SimpleGameChat
 * by providing a MessageContext and integrating VoiceHandler
 */

import { Send, Loader2, LogOut } from 'lucide-react';
import React, { useState, useEffect, useRef, useCallback, useMemo, useId } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { DMChatBubble } from './chat/DMChatBubble';

import type { ChatMessage } from '@/services/ai-service';
import type { AutoRollResult } from '@/services/combat/npc-auto-roller';

import { NPCRollDisplay, useNPCRollQueue } from '@/components/game/NPCRollDisplay';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SimpleMessageProvider } from '@/contexts/SimpleMessageContext';
import { useChatHistory } from '@/features/game-session/hooks/use-chat-history';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { useSimpleGameSession } from '@/hooks/use-simple-game-session';
import logger from '@/lib/logger';
import { handleAsyncError } from '@/utils/error-handler';

/**
 * PlayerChatBubble Component
 * Memoized to prevent re-renders when other messages or state changes
 */
const PlayerChatBubble = React.memo(
  ({ content, timestamp }: { content: string; timestamp: Date }) => (
    <div className="flex justify-end">
      <div className="max-w-[80%] p-4 rounded-lg shadow-sm bg-infinite-purple text-white ml-4">
        <div className="whitespace-pre-wrap leading-relaxed">{content}</div>
        <div className="text-xs mt-2 text-infinite-purple-100">
          {timestamp.toLocaleTimeString()}
        </div>
      </div>
    </div>
  ),
);

PlayerChatBubble.displayName = 'PlayerChatBubble';

interface SimpleGameChatWithVoiceProps {
  campaignId: string;
  characterId: string;
  campaignDetails?: Record<string, unknown>;
  characterDetails?: Record<string, unknown>;
}

export const SimpleGameChatWithVoice: React.FC<SimpleGameChatWithVoiceProps> = ({
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
  const [currentMessage, setCurrentMessage] = useState('');
  const [isEndSessionDialogOpen, setIsEndSessionDialogOpen] = useState(false);
  const chatInputId = useId();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // NPC Roll Display
  const [showNPCRolls] = useLocalStorage('game:showNPCRolls', true);
  const { currentRoll, addRolls, dismissCurrent } = useNPCRollQueue();

  /**
   * Extracted chat history and message logic
   */
  const { messages, isSending, isLoadingHistory, hasLoadedHistory, sendMessage } = useChatHistory({
    sessionId: session?.id,
    campaignId,
    characterId,
    campaignDetails,
    characterDetails,
    onMessageReceived: (response: unknown) => {
      // Display NPC roll popups if enabled and rolls are present
      if (showNPCRolls && response && typeof response === 'object') {
        const res = response as Record<string, unknown>;
        const context = res.context as Record<string, unknown> | undefined;
        const npcRolls = context?.npcRollResults;

        if (Array.isArray(npcRolls) && npcRolls.length > 0) {
          logger.info(`🎲 Adding ${npcRolls.length} NPC rolls to display queue`);
          addRolls(npcRolls as AutoRollResult[]);
        }
      }
    },
  });

  // Scroll to bottom when messages change
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  /**
   * Handle form submission
   */
  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (currentMessage.trim() && !isSending) {
        const message: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'user',
          content: currentMessage.trim(),
          timestamp: new Date(),
        };
        sendMessage(message);
        setCurrentMessage('');
      }
    },
    [currentMessage, isSending, sendMessage],
  );

  /**
   * End game session confirmation
   */
  const handleEndSession = useCallback(() => {
    if (!session) {
      logger.warn('No session to end');
      navigate('/');
      return;
    }
    setIsEndSessionDialogOpen(true);
  }, [session, navigate]);

  /**
   * Confirm end game session
   */
  const confirmEndSession = useCallback(async () => {
    if (!session) {
      return;
    }

    setIsEndSessionDialogOpen(false);
    try {
      await endSession(session.id);
      toast.success('Adventure ended. Your progress has been saved.');
      navigate('/');
    } catch (error) {
      handleAsyncError(error, {
        userMessage: 'Failed to end session properly, but navigating home.',
        context: { location: 'SimpleGameChatWithVoice.handleEndSession', sessionId: session.id },
      });
      navigate('/');
    }
  }, [session, endSession, navigate]);

  // ⚡ Bolt: Memoize the message list to prevent re-mapping on every re-render (e.g. during typing)
  const renderedMessages = useMemo(
    () =>
      messages.map((message) =>
        message.role === 'assistant' ? (
          <DMChatBubble
            key={message.id}
            message={message}
            narrationSegments={message.narrationSegments}
          />
        ) : (
          <PlayerChatBubble
            key={message.id}
            content={message.content}
            timestamp={message.timestamp}
          />
        ),
      ),
    [messages],
  );

  // Loading state - only show loading if we're actually loading something
  if (sessionLoading || (isLoadingHistory && !hasLoadedHistory)) {
    return (
      <Card className="h-[600px] flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-infinite-purple" />
          <p className="text-muted-foreground">
            {sessionLoading ? 'Starting your adventure...' : 'Loading your story...'}
          </p>
        </div>
      </Card>
    );
  }

  // Error state
  if (!session) {
    return (
      <Card className="h-[600px] flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-destructive">Failed to start game session.</p>
          <Button onClick={() => window.location.reload()}>Retry</Button>
        </div>
      </Card>
    );
  }

  return (
    <SimpleMessageProvider
      messages={messages}
      isLoading={isSending}
      sendMessage={sendMessage}
      queueStatus={isSending ? 'processing' : 'idle'}
    >
      <div className="space-y-4">
        <Card className="h-[600px] flex flex-col relative">
          <CardHeader className="flex-shrink-0 p-4 pb-0">
            <h3 className="text-lg font-semibold text-foreground opacity-80">
              Adventure Chronicle
            </h3>
          </CardHeader>

          <Button
            variant="ghost"
            size="icon"
            onClick={handleEndSession}
            className="absolute top-3 right-3 h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/5"
            aria-label="End Adventure"
            title="End Adventure"
          >
            <LogOut className="h-4 w-4" />
          </Button>

          <CardContent className="flex-1 flex flex-col overflow-hidden p-0 pt-2">
            {/* Messages Area */}
            <ScrollArea className="flex-1 px-6 py-4" aria-label="Chat history">
              <div className="space-y-4 pb-4">
                {renderedMessages}

                {/* Loading indicator */}
                {isSending && (
                  <div className="flex justify-start">
                    <div className="max-w-[80%] p-4 rounded-lg shadow-sm bg-muted text-foreground mr-4">
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="text-muted-foreground">
                          The DM ponders your actions...
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            {/* Input Area */}
            <div className="flex-shrink-0 p-6 border-t bg-card">
              <form onSubmit={handleSubmit} className="flex gap-2">
                <div className="flex-1">
                  <Label htmlFor={chatInputId} className="sr-only">
                    Describe your actions
                  </Label>
                  <Input
                    id={chatInputId}
                    value={currentMessage}
                    onChange={(e) => setCurrentMessage(e.target.value)}
                    placeholder="Describe your actions..."
                    disabled={isSending}
                    className="w-full"
                    maxLength={500}
                  />
                </div>
                <Button
                  type="submit"
                  disabled={isSending || !currentMessage.trim()}
                  size="sm"
                  className="px-4"
                  aria-label={isSending ? 'Sending...' : 'Send Message'}
                  title={isSending ? 'Sending...' : 'Send Message'}
                >
                  {isSending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </form>

              <div className="text-xs text-muted-foreground mt-2 flex items-center justify-between">
                <span>Press Enter to send • Shift+Enter for new line</span>
                <span>{currentMessage.length}/500</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* NPC Roll Display Popup */}
      {showNPCRolls && currentRoll && (
        <NPCRollDisplay roll={currentRoll} onDismiss={dismissCurrent} autoDismissDelay={3000} />
      )}

      {/* End Session Confirmation Dialog */}
      <AlertDialog open={isEndSessionDialogOpen} onOpenChange={setIsEndSessionDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End Adventure?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to end this adventure? Your progress will be saved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmEndSession}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              End Adventure
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SimpleMessageProvider>
  );
};
