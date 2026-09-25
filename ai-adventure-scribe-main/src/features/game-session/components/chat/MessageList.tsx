import React, { useState, useRef } from 'react';
import { useParams } from 'react-router-dom';

import { MessageListContainer } from './message-list/MessageListContainer';
import { useImageGeneration } from './message-list/useImageGeneration';
import { useScrollBehavior } from './message-list/useScrollBehavior';

import type { ChatMessage } from '@/types/game';

import { useCampaignAssetsContext } from '@/contexts/CampaignAssetsContext';
import { useCampaign } from '@/contexts/CampaignContext';
import { useCharacter } from '@/contexts/CharacterContext';
import { useMessageContext } from '@/contexts/MessageContext';
import logger from '@/lib/logger';
import { handleAsyncError } from '@/utils/error-handler';

/**
 * Context for dice roll messages to preserve intent through the message flow
 */
export interface DiceRollContext {
  intent: 'dice_roll';
  diceRoll?: {
    formula: string;
    count: number;
    dieType: number;
    modifier: number;
    advantage?: boolean;
    disadvantage?: boolean;
    results?: number[];
    keptResults?: number[];
    total: number;
    naturalRoll?: number;
    critical?: boolean;
    requestType?: string;
    description?: string;
    dc?: number;
    ac?: number;
    success?: boolean;
    timestamp?: string;
  };
}

export interface SpellCastContext {
  intent: 'spell_cast';
  spellId: string;
  spellLevel: number | null;
}

export type MessageSendContext = DiceRollContext | SpellCastContext;

interface MessageListProps {
  onSendFullMessage?: (message: string, context?: MessageSendContext) => Promise<void>;
  sessionId?: string;
  containerRef?: React.RefObject<HTMLDivElement>;
  suppressEmptyState?: boolean;
}

/**
 * MessageList Component
 * Displays a list of chat messages with styling based on sender type
 * Refactored to use sub-components and custom hooks for better maintainability
 *
 * ⚡ Bolt: Wrapped in React.memo to prevent redundant re-renders of the entire message list
 * when parent components update. Sub-components (MessageListContainer) are already
 * memoized or optimized via custom hooks.
 */
export const MessageList: React.FC<MessageListProps> = React.memo(
  ({ onSendFullMessage, sessionId, containerRef, suppressEmptyState }) => {
    const { messages = [], sendMessage, hasMore, loadMore, isFetchingMore } = useMessageContext();
    const { state: characterState } = useCharacter();
    const { state: campaignState } = useCampaign();
    const { getAssetImageUrl } = useCampaignAssetsContext();
    const { id: routeCampaignId } = useParams<{ id: string }>();

    const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());
    const internalRef = useRef<HTMLDivElement | null>(null);
    const messagesRef = (containerRef as React.RefObject<HTMLDivElement>) || internalRef;
    const [combatEntrySpace, setCombatEntrySpace] = useState(0);

    // Custom hooks for feature isolation
    const { generatingFor, imageByMessage, genErrorByMessage, handleGenerateScene } =
      useImageGeneration({
        sessionId,
        routeCampaignId,
        character: characterState.character,
        campaign: campaignState.campaign,
        messages,
        getAssetImageUrl,
      });

    useScrollBehavior(messagesRef, messages, hasMore, loadMore, isFetchingMore);

    // Handle option selection
    const handleOptionSelect = React.useCallback(
      async (optionText: string) => {
        logger.info('[MessageList] Handling option selection:', optionText);
        try {
          if (onSendFullMessage) {
            await onSendFullMessage(optionText);
          } else {
            const playerMessage: ChatMessage = {
              text: optionText,
              sender: 'player',
              timestamp: new Date().toISOString(),
            };
            await sendMessage(playerMessage);
          }
        } catch (error) {
          handleAsyncError(error, {
            userMessage: 'Failed to send option selection',
            context: { location: 'MessageList.handleOptionSelect' },
          });
        }
      },
      [onSendFullMessage, sendMessage],
    );

    return (
      <div className="flex-1 min-h-0">
        <div
          className="chat-scroll parchment-panel flex-1 min-h-0 min-w-0 max-w-full space-y-6 overflow-x-hidden overflow-y-auto bg-gradient-to-b from-background/50 to-background/30 px-4 py-4 md:px-6 md:py-6"
          role="log"
          aria-live="polite"
          ref={messagesRef}
          style={{
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            height: '100%',
            minHeight: '400px',
            paddingBottom: combatEntrySpace || undefined,
          }}
        >
          <MessageListContainer
            messages={messages}
            messagesRef={messagesRef}
            expandedMessages={expandedMessages}
            setExpandedMessages={setExpandedMessages}
            imageByMessage={imageByMessage}
            generatingFor={generatingFor}
            genErrorByMessage={genErrorByMessage}
            onGenerateScene={handleGenerateScene}
            onOptionSelect={handleOptionSelect}
            onSendMessage={sendMessage}
            onSendFullMessage={onSendFullMessage}
            sessionId={sessionId}
            isFetchingMore={isFetchingMore}
            hasMore={hasMore}
            suppressEmptyState={suppressEmptyState}
            onCombatEntrySpaceChange={setCombatEntrySpace}
          />
        </div>
      </div>
    );
  },
);
