import { Loader2 } from 'lucide-react';
import React from 'react';

import type { ChatMessage } from '@/services/ai-service';

import { ScrollArea } from '@/components/ui/scroll-area';

interface SimpleMessageListProps {
  messages: ChatMessage[];
  isSending: boolean;
  isLoadingHistory: boolean;
  streamingMessage: string;
  onOptionSelect: (option: string) => void;
  onOptionDoubleClick: (option: string) => void;
  messagesEndRef: React.RefObject<HTMLDivElement>;
}

/**
 * Helper: extract short choices from DM message text (lines starting with A. B. C. or 1.)
 * Extracted from SimpleGameChat.tsx
 */
const extractChoices = (text: string): string[] => {
  const lines = text.split('\n');
  const choices: string[] = [];
  lines.forEach((line) => {
    const m = line.trim().match(/^([A-D]|\d+)\.\s*(.+)/);
    if (m) {
      choices.push(m[2].trim());
    }
  });
  return choices;
};

/**
 * ⚡ Bolt: Memoized individual message item to prevent redundant re-renders
 * of historical messages when new messages arrive or during streaming.
 */
const MessageItem = React.memo(
  ({
    message,
    onOptionSelect,
    onOptionDoubleClick,
  }: {
    message: ChatMessage;
    onOptionSelect: (option: string) => void;
    onOptionDoubleClick: (option: string) => void;
  }) => {
    const choices = message.role !== 'user' ? extractChoices(message.content) : [];

    return (
      <div className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
        <div
          className={`flex max-w-[80%] ${message.role === 'user' ? 'flex-row-reverse' : 'flex-row'} items-start`}
        >
          {message.role !== 'user' && (
            <div className="flex-shrink-0 mr-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium avatar-dm">
                DM
              </div>
            </div>
          )}

          <div
            className={`rounded-lg px-5 py-3 message-bubble ${message.role === 'user' ? 'player-bubble ml-4' : 'dm-bubble mr-4'}`}
          >
            <div className="text-sm font-medium mb-1">
              {message.role === 'user' ? 'You' : 'Dungeon Master'}
            </div>
            <div className="whitespace-pre-wrap">{message.content}</div>
            <div className="text-xs opacity-70 mt-2 message-meta">
              {message.timestamp.toLocaleTimeString?.()}
            </div>

            {/* Render choices if present */}
            {choices.length > 0 && (
              <div className="choice-list" role="list">
                {choices.map((c, i) => (
                  <button
                    key={i}
                    type="button"
                    className="choice-btn"
                    onClick={() => onOptionSelect(c)}
                    onDoubleClick={() => onOptionDoubleClick(c)}
                    aria-label={`Choose ${c}`}
                  >
                    {String.fromCharCode(65 + i)}. {c}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  },
);

MessageItem.displayName = 'MessageItem';

/**
 * SimpleMessageList Component
 * Extracted from SimpleGameChat.tsx to reduce file size and improve maintainability.
 * Handles the rendering of chat messages and interactive choices.
 *
 * ⚡ Bolt: Wrapped in React.memo to prevent re-rendering the entire list
 * when the parent component (chat input) updates.
 */
export const SimpleMessageList: React.FC<SimpleMessageListProps> = React.memo(
  ({
    messages,
    isSending,
    isLoadingHistory,
    streamingMessage,
    onOptionSelect,
    onOptionDoubleClick,
    messagesEndRef,
  }) => {
    return (
      <ScrollArea className="flex-1 p-4 chat-scroll">
        {isLoadingHistory ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />
            <span className="text-muted-foreground">Loading conversation...</span>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <p>Welcome to your adventure! What would you like to do?</p>
              </div>
            )}

            {messages.map((message) => (
              <MessageItem
                key={message.id}
                message={message}
                onOptionSelect={onOptionSelect}
                onOptionDoubleClick={onOptionDoubleClick}
              />
            ))}

            {isSending && (
              <div className="flex justify-start">
                <div className="rounded-lg px-5 py-3 dm-bubble mr-4 max-w-[80%]">
                  <div className="text-sm font-medium mb-1">Dungeon Master</div>
                  {streamingMessage ? (
                    <div className="whitespace-pre-wrap">
                      {streamingMessage}
                      <span className="animate-pulse">|</span>
                    </div>
                  ) : (
                    <div className="flex items-center space-x-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-sm">Thinking...</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </ScrollArea>
    );
  },
);

SimpleMessageList.displayName = 'SimpleMessageList';
