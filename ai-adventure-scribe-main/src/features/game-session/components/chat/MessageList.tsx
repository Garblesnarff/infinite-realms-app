import React, { useState, useRef } from 'react';
import { useParams } from 'react-router-dom';

import { MessageListContainer } from './message-list/MessageListContainer';
import { useImageGeneration } from './message-list/useImageGeneration';
import { useScrollBehavior } from './message-list/useScrollBehavior';

import type { CampaignContext as ImageCampaignContext } from './message-list/buildSceneImageRequest';
import type { ChatMessage } from '@/types/game';

import { useCampaignAssetsContext } from '@/contexts/CampaignAssetsContext';
import { useCampaign } from '@/contexts/CampaignContext';
import { useCharacter } from '@/contexts/CharacterContext';
import { useCombat } from '@/contexts/CombatContext';
import { useMessageContext } from '@/contexts/MessageContext';
import logger from '@/lib/logger';
import { handleAsyncError } from '@/utils/error-handler';

/**
 * Context for dice roll messages to preserve intent through the message flow
 */
export interface DiceRollContext {
  rollRequestId?: string;
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

/**
 * Re-run the turn for the player's last message, which has no DM reply because the page was
 * reloaded while the combat-entry popup held it (#2341). The message is already saved.
 */
export interface ResumeUnansweredTurnContext {
  intent: 'resume_unanswered';
  /** Replacement text supplied by the retry composer; the saved row remains untouched. */
  retryInput?: string;
}

/**
 * The dying player's turn (#2518). It is sent by the dying panel's driver, not typed: the turn is
 * a death saving throw the player rolls, resolved by the engine, then narrated by the DM.
 */
export interface DeathSaveTurnContext {
  intent: 'death_save_turn';
}

export type MessageSendContext =
  | DiceRollContext
  | SpellCastContext
  | ResumeUnansweredTurnContext
  | DeathSaveTurnContext;

interface MessageListProps {
  retryInFlight?: boolean;
  onSendFullMessage?: (message: string, context?: MessageSendContext) => Promise<void>;
  /** #88: re-run a failed turn (the composer banner's retry action). */
  onRetryTurn?: (input: string) => void | Promise<void>;
  /** #88: the DM is composing; the container shows the writing row. */
  isDmWriting?: boolean;
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
  ({
    onSendFullMessage,
    onRetryTurn,
    isDmWriting = false,
    sessionId,
    containerRef,
    suppressEmptyState,
    retryInFlight,
  }) => {
    const {
      messages = [],
      isLoading,
      messagesReady,
      sendMessage,
      hasMore,
      loadMore,
      isFetchingMore,
      failedSends = [],
      clearFailedSend,
    } = useMessageContext();
    const { state: characterState } = useCharacter();
    const { state: campaignState } = useCampaign();
    const { state: combatState } = useCombat();
    const { getAssetImageUrl } = useCampaignAssetsContext();
    const { id: routeCampaignId } = useParams<{ id: string }>();

    const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());
    const internalRef = useRef<HTMLDivElement | null>(null);
    const messagesRef = (containerRef as React.RefObject<HTMLDivElement>) || internalRef;

    // Custom hooks for feature isolation
    const { generatingFor, imageByMessage, genErrorByMessage, handleGenerateScene } =
      useImageGeneration({
        sessionId,
        routeCampaignId,
        character: characterState.character,
        campaign: campaignState.campaign as unknown as ImageCampaignContext | null,
        messages,
        getAssetImageUrl,
      });

    useScrollBehavior(
      messagesRef,
      messages,
      hasMore,
      loadMore,
      isFetchingMore,
      combatState.isInCombat,
    );

    // #88: retry a failed send. The row clears first so a failed retry
    // replaces it instead of stacking a second one. The turn retry is the
    // same action as the composer banner's Retry, so a retried turn clears
    // the banner and runs the whole turn — a plain re-persist would leave
    // the turn dead with no DM reply.
    const handleRetryFailed = React.useCallback(
      async (message: ChatMessage) => {
        clearFailedSend?.(message);
        if (onRetryTurn) {
          await onRetryTurn(message.text);
        } else if (onSendFullMessage) {
          await onSendFullMessage(message.text);
        } else {
          const { context, ...rest } = message;
          await sendMessage({
            ...rest,
            ...(context ? { context: { ...context, sendFailed: false } } : {}),
          });
        }
      },
      [clearFailedSend, onRetryTurn, onSendFullMessage, sendMessage],
    );

    // Free-text choices are staged in DynamicOptionsSection before this runs.
    // This callback sends. Combat text fallbacks (a chip the engine does not
    // run) use it too, the same way the action bar calls handleSendMessage,
    // so they must not stop in the composer (#760).
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
      // No minimum height: the stream is what shrinks when the roll tray opens below it, so the
      // tray and the chat box stay on screen and the newest line stays visible (#2252).
      <div className="flex min-h-0 flex-1 flex-col">
        <div
          className="chat-scroll parchment-panel flex-1 min-h-0 min-w-0 max-w-full space-y-6 overflow-x-hidden overflow-y-auto bg-gradient-to-b from-background/50 to-background/30 px-4 py-4 md:px-6 md:py-6"
          role="log"
          aria-live="polite"
          ref={messagesRef}
          style={{
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
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
            failedMessages={failedSends}
            onRetryFailed={handleRetryFailed}
            isDmWriting={isDmWriting}
            retryInFlight={retryInFlight}
            sessionId={sessionId}
            messagesReady={messagesReady && !isLoading}
            isFetchingMore={isFetchingMore}
            hasMore={hasMore}
            suppressEmptyState={suppressEmptyState}
          />
        </div>
      </div>
    );
  },
);
