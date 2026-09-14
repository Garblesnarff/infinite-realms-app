import React, { useMemo } from 'react';

import { MessageRenderer } from './MessageRenderer';
import { useMessageDiceRolls } from './use-message-dice-rolls';

import type { MessageSendContext } from '../MessageList';
import type { ChatMessage } from '@/types/game';

import { CombatEntryConfirmation } from '@/components/combat/CombatEntryConfirmation';
import { PendingIntentConfirmation } from '@/components/combat/PendingIntentConfirmation';
import { DiceRollRequest } from '@/components/game/DiceRollRequest';
import { Z_INDEX } from '@/constants/z-index';
import { useCombat } from '@/contexts/CombatContext';
import { useCombatEntryConfirmationHost } from '@/hooks/combat/use-combat-entry-confirmation-host';
import { usePlayerRollHost } from '@/hooks/combat/use-player-roll-host';
import { markPlayerRollCommitted } from '@/services/combat/player-roll-bridge';

interface MessageListContainerProps {
  messages: ChatMessage[];
  messagesRef: React.RefObject<HTMLDivElement>;
  expandedMessages: Set<string>;
  setExpandedMessages: React.Dispatch<React.SetStateAction<Set<string>>>;
  imageByMessage: Record<string, { url: string; prompt: string }>;
  generatingFor: Set<string>;
  genErrorByMessage: Record<string, string>;
  onGenerateScene: (message: ChatMessage & { id?: string; timestamp?: string }) => Promise<void>;
  onOptionSelect: (optionText: string) => Promise<void>;
  onSendMessage: (message: ChatMessage) => Promise<void>;
  onSendFullMessage?: (message: string, context?: MessageSendContext) => Promise<void>;
  sessionId?: string;
  isFetchingMore?: boolean;
  hasMore?: boolean;
  suppressEmptyState?: boolean;
}

/**
 * MessageListContainer Component
 * Main orchestrator for message list functionality
 * - Groups messages by sender
 * - Handles scroll behavior
 * - Manages dice roll queue from GameContext
 * - Renders message groups with avatars
 */
export const MessageListContainer: React.FC<MessageListContainerProps> = React.memo(
  ({
    messages,
    messagesRef: _messagesRef,
    expandedMessages,
    setExpandedMessages,
    imageByMessage,
    generatingFor,
    genErrorByMessage,
    onGenerateScene,
    onOptionSelect,
    onSendMessage,
    onSendFullMessage,
    sessionId,
    isFetchingMore,
    hasMore,
    suppressEmptyState = false,
  }) => {
    const { state: combatState, refreshCombatState } = useCombat();
    const entryConfirmation = useCombatEntryConfirmationHost(sessionId);
    const {
      currentRoll,
      batchProgress,
      rollRequest,
      handleDiceRoll,
      handleManualResult,
      handleCancelRoll,
      lastRollRef: _lastRollRef,
    } = useMessageDiceRolls({ onSendMessage, onSendFullMessage });

    // Combat asks the player for their own attack die through this popup. Registered here
    // because this is where the queue is already rendered; see use-player-roll-host.
    usePlayerRollHost();

    // Group consecutive messages from the same sender
    const groupedMessages = useMemo(() => {
      if (!messages.length) {
        return [];
      }

      const groups: {
        sender: string;
        messages: ChatMessage[];
        isPlayer: boolean;
        isCompanion: boolean;
      }[] = [];
      let currentGroup = {
        sender: messages[0].sender,
        messages: [messages[0]],
        isPlayer: messages[0].sender === 'player',
        isCompanion: messages[0].sender === 'companion',
      };

      for (let i = 1; i < messages.length; i++) {
        const message = messages[i];
        if (message.sender === currentGroup.sender) {
          currentGroup.messages.push(message);
        } else {
          groups.push(currentGroup);
          currentGroup = {
            sender: message.sender,
            messages: [message],
            isPlayer: message.sender === 'player',
            isCompanion: message.sender === 'companion',
          };
        }
      }
      groups.push(currentGroup);
      return groups;
    }, [messages]);

    return (
      <>
        <CombatEntryConfirmation confirmation={entryConfirmation} />

        <PendingIntentConfirmation
          encounter={combatState.activeEncounter}
          onRefresh={refreshCombatState}
          onSendFullMessage={onSendFullMessage}
        />

        {/* Loading indicator at top when fetching more */}
        {isFetchingMore && hasMore && (
          <div className="flex justify-center py-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <span>Loading older messages...</span>
            </div>
          </div>
        )}

        {groupedMessages.map((group, groupIndex) => (
          <div
            key={`group-${groupIndex}`}
            className={`flex ${group.isPlayer ? 'justify-end' : 'justify-start'} group`}
          >
            <div
              className={`flex max-w-[90%] ${group.isPlayer ? 'flex-row-reverse' : 'flex-row'} items-start`}
            >
              {/* Avatar for first message in group */}
              {group.isCompanion ? (
                <div className="flex-shrink-0 mr-3 mb-2">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium bg-infinite-teal/20 text-infinite-teal border-2 border-infinite-teal/50"
                    aria-hidden
                  >
                    {(group.messages[0].speakerName || group.messages[0].characterName || 'C')
                      .charAt(0)
                      .toUpperCase()}
                  </div>
                </div>
              ) : !group.isPlayer ? (
                <div className="flex-shrink-0 mr-3 mb-2">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium bg-primary text-primary-foreground"
                    aria-hidden
                  >
                    DM
                  </div>
                </div>
              ) : (
                <div className="flex-shrink-0 ml-3 mb-2">
                  {group.messages[0].characterAvatar ? (
                    <img
                      src={group.messages[0].characterAvatar}
                      alt="Character avatar"
                      className="w-10 h-10 rounded-full object-cover border-2 border-card"
                    />
                  ) : (
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium bg-card text-card-foreground border-2 border-primary"
                      aria-hidden
                    >
                      {group.messages[0].characterName?.charAt(0).toUpperCase() || 'P'}
                    </div>
                  )}
                </div>
              )}

              <div
                className={`flex flex-col ${group.isPlayer ? 'items-end' : 'items-start'} space-y-2 w-full`}
              >
                {group.messages.map((message, msgIndex) => {
                  const messageId = message.id || message.timestamp || `${groupIndex}-${msgIndex}`;
                  return (
                    <MessageRenderer
                      key={messageId}
                      message={message}
                      messageId={messageId}
                      groupIndex={groupIndex}
                      msgIndex={msgIndex}
                      isFirstInGroup={msgIndex === 0}
                      isLastInGroup={msgIndex === group.messages.length - 1}
                      isPlayer={group.isPlayer}
                      isDM={message.sender === 'dm'}
                      isCompanion={group.isCompanion}
                      expandedMessages={expandedMessages}
                      setExpandedMessages={setExpandedMessages}
                      imageByMessage={imageByMessage}
                      generatingFor={generatingFor}
                      genErrorByMessage={genErrorByMessage}
                      onGenerateScene={onGenerateScene}
                      onOptionSelect={onOptionSelect}
                      characterName={group.messages[0].characterName}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        ))}

        {/* Global Dice Roll Request - Shows current roll from GameContext queue */}
        {currentRoll && rollRequest && (
          <div
            className="fixed bottom-24 left-1/2 transform -translate-x-1/2"
            style={{ zIndex: Z_INDEX.POPOVER }}
          >
            <DiceRollRequest
              key={currentRoll.id}
              request={rollRequest}
              onRoll={handleDiceRoll}
              onManualResult={handleManualResult}
              onRollCommit={
                currentRoll.combatInitiativeRoll
                  ? () => markPlayerRollCommitted(currentRoll.id)
                  : undefined
              }
              onCancel={handleCancelRoll}
              batchProgress={batchProgress}
              className="shadow-2xl animate-in slide-in-from-bottom-4 duration-300"
            />
          </div>
        )}

        {/* Loading state */}
        {!suppressEmptyState && messages?.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <div className="w-16 h-16 bg-gradient-to-br from-infinite-purple to-infinite-teal rounded-full flex items-center justify-center mb-6 animate-pulse">
              <span className="text-2xl">🎭</span>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-center gap-2">
                <div className="w-2 h-2 bg-infinite-purple rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                <div className="w-2 h-2 bg-infinite-purple rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                <div className="w-2 h-2 bg-infinite-purple rounded-full animate-bounce"></div>
              </div>
              <h3 className="text-lg font-medium text-card-foreground">Your adventure awaits...</h3>
              <p className="text-muted-foreground max-w-sm text-sm">
                The Dungeon Master is crafting your opening scene and preparing your world.
              </p>
            </div>
          </div>
        )}
      </>
    );
  },
);
