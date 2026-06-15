import { Send, LogOut, Loader2 } from 'lucide-react';
import React from 'react';
import { toast } from 'sonner';

import { SimpleMessageList } from './SimpleMessageList';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useSimpleChatLogic } from '@/features/game-session/hooks/use-simple-chat-logic';

interface SimpleGameChatProps {
  campaignId: string;
  characterId: string;
  campaignDetails?: unknown;
  characterDetails?: unknown;
}

/**
 * Simple chat component for game sessions
 * Delegates logic to useSimpleChatLogic hook
 */
export const SimpleGameChat: React.FC<SimpleGameChatProps> = ({
  campaignId,
  characterId,
  campaignDetails,
  characterDetails,
}) => {
  const {
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
  } = useSimpleChatLogic({
    campaignId,
    characterId,
    campaignDetails,
    characterDetails,
  });

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
