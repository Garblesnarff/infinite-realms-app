import React, { useMemo, useState, useRef, useEffect } from 'react';

import { MessageRenderer } from './MessageRenderer';

import type { ChatMessage } from '@/types/game';

import { DiceRollRequest } from '@/components/game/DiceRollRequest';
import { Z_INDEX } from '@/constants/z-index';
import { useGame } from '@/contexts/GameContext';
import logger from '@/lib/logger';
import { rollDice } from '@/utils/diceUtils';
import { handleAsyncError } from '@/utils/error-handler';

interface MessageListContainerProps {
  messages: ChatMessage[];
  messagesRef: React.RefObject<HTMLDivElement>;
  expandedMessages: Set<string>;
  setExpandedMessages: React.Dispatch<React.SetStateAction<Set<string>>>;
  dynamicOptions: { key: string; lines: string[] } | null;
  imageByMessage: Record<string, { url: string; prompt: string }>;
  generatingFor: Set<string>;
  genErrorByMessage: Record<string, string>;
  onGenerateScene: (message: ChatMessage & { id?: string; timestamp?: string }) => Promise<void>;
  onOptionSelect: (optionText: string) => Promise<void>;
  onSendMessage: (message: ChatMessage) => Promise<void>;
  onSendFullMessage?: (message: string) => Promise<void>;
  isFetchingMore?: boolean;
  hasMore?: boolean;
  suppressEmptyState?: boolean;
}

// Type for last roll metadata
type LastRollMeta = {
  kind: 'attack' | 'skill_check' | 'save' | 'damage' | 'initiative' | 'generic';
  skill?: string;
  weapon?: string;
  label?: string;
  result: number;
  nat?: number;
  dc?: number;
  ac?: number;
  success?: boolean;
};

/**
 * MessageListContainer Component
 * Main orchestrator for message list functionality
 * - Groups messages by sender
 * - Handles scroll behavior
 * - Manages dice roll queue from GameContext
 * - Renders message groups with avatars
 */
export const MessageListContainer: React.FC<MessageListContainerProps> = ({
  messages,
  messagesRef,
  expandedMessages,
  setExpandedMessages,
  dynamicOptions,
  imageByMessage,
  generatingFor,
  genErrorByMessage,
  onGenerateScene,
  onOptionSelect,
  onSendMessage,
  onSendFullMessage,
  isFetchingMore,
  hasMore,
  suppressEmptyState = false,
}) => {
  const { getCurrentDiceRoll, completeDiceRoll, cancelDiceRoll, isBatchComplete, getBatchResults, clearBatch } = useGame();
  const lastRollRef = useRef<LastRollMeta | null>(null);

  // Group consecutive messages from the same sender
  const groupedMessages = useMemo(() => {
    if (!messages.length) {
      return [];
    }

    const groups: { sender: string; messages: ChatMessage[]; isPlayer: boolean }[] = [];
    let currentGroup = {
      sender: messages[0].sender,
      messages: [messages[0]],
      isPlayer: messages[0].sender === 'player',
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
        };
      }
    }
    groups.push(currentGroup);
    return groups;
  }, [messages]);

  // Handle dice roll from queue
  // FIXED: Wait for ALL rolls in a batch to complete before triggering AI response
  const handleDiceRoll = React.useCallback(
    async (formula: string, advantage?: boolean, disadvantage?: boolean) => {
      logger.info('[MessageListContainer] Handling dice roll from queue:', {
        formula,
        advantage,
        disadvantage,
      });

      const currentRoll = getCurrentDiceRoll();
      if (!currentRoll) {
        logger.warn('[MessageListContainer] No current dice roll in queue');
        return;
      }

      try {
        const diceMatch = formula.match(/(\d+)d(\d+)([+-]\d+)?/);
        if (!diceMatch) {
          logger.error('[MessageListContainer] Invalid dice formula:', formula);
          return;
        }

        const count = parseInt(diceMatch[1]);
        const dieType = parseInt(diceMatch[2]);
        const modifier = diceMatch[3] ? parseInt(diceMatch[3]) : 0;

        const rollResult = rollDice(dieType, count, modifier, {
          advantage: advantage || false,
          disadvantage: disadvantage || false,
        });

        // Complete this roll (marks it done in the batch)
        completeDiceRoll(currentRoll.id, rollResult);

        // Capture last roll meta for potential future use
        const mapKind = (t: string): LastRollMeta['kind'] => {
          if (t === 'attack') return 'attack';
          if (t === 'damage') return 'damage';
          if (t === 'initiative') return 'initiative';
          if (['saving_throw', 'death_save', 'concentration_save'].includes(t)) return 'save';
          if (['ability_check', 'skill_check'].includes(t)) return 'skill_check';
          return 'generic';
        };

        lastRollRef.current = {
          kind: mapKind(currentRoll.requestType),
          label: currentRoll.description,
          result: rollResult.total,
          nat: rollResult.naturalRoll,
          dc: currentRoll.dc,
          ac: currentRoll.ac,
          success: currentRoll.dc ? rollResult.total >= currentRoll.dc : currentRoll.ac ? rollResult.total >= currentRoll.ac : undefined,
        };

        // Check if this was the last roll in the batch
        // Use setTimeout to allow state to settle after completeDiceRoll
        setTimeout(async () => {
          if (isBatchComplete()) {
            logger.info('[MessageListContainer] Batch complete, sending combined roll results');

            // Get all completed rolls from this batch
            const batchResults = getBatchResults();

            // Format all roll results into a single message
            const rollTexts = batchResults.map(roll => {
              const total = roll.result?.total ?? 0;
              const nat = roll.result?.naturalRoll ?? total;
              const dc = roll.dc;
              const ac = roll.ac;
              const success = dc ? total >= dc : ac ? total >= ac : null;
              const successText = success !== null ? (success ? '✓' : '✗') : '';
              return `${roll.description}: ${total} (nat ${nat}${roll.rollConfig?.modifier ? (roll.rollConfig.modifier >= 0 ? '+' : '') + roll.rollConfig.modifier : ''}) ${successText}`;
            });

            const combinedText = rollTexts.join('\n');

            const diceRollMessage: ChatMessage = {
              text: combinedText,
              sender: 'player',
              timestamp: new Date().toISOString(),
              context: {
                intent: 'dice_roll',
                diceRoll: {
                  formula,
                  count,
                  dieType,
                  modifier,
                  advantage: advantage || false,
                  disadvantage: disadvantage || false,
                  results: rollResult.results,
                  keptResults: rollResult.keptResults,
                  total: rollResult.total,
                  naturalRoll: rollResult.naturalRoll,
                  critical: rollResult.critical,
                  timestamp: new Date().toISOString(),
                  // Include all batch results for AI context
                  batchResults: batchResults.map(r => ({
                    description: r.description,
                    total: r.result?.total,
                    dc: r.dc,
                    ac: r.ac,
                    success: r.dc ? (r.result?.total ?? 0) >= r.dc : r.ac ? (r.result?.total ?? 0) >= r.ac : null,
                  })),
                },
              },
            };

            await onSendMessage(diceRollMessage);

            // Clear the batch state
            clearBatch();
          } else {
            logger.info('[MessageListContainer] Batch not complete, waiting for more rolls');
          }
        }, 50); // Small delay to let state update
      } catch (error) {
        handleAsyncError(error, {
          userMessage: 'Failed to process dice roll',
          context: { location: 'MessageListContainer.handleDiceRoll' },
        });
      }
    },
    [onSendMessage, getCurrentDiceRoll, completeDiceRoll, isBatchComplete, getBatchResults, clearBatch],
  );

  // Handle manual dice result input
  // FIXED: Wait for ALL rolls in a batch to complete before triggering AI response
  const handleManualResult = React.useCallback(
    async (result: number) => {
      const currentRoll = getCurrentDiceRoll();
      if (!currentRoll) {
        logger.warn('[MessageListContainer] No current dice roll in queue');
        return;
      }

      try {
        let numericResult: number;
        if (typeof result === 'number') {
          numericResult = result;
        } else if (typeof result === 'object' && result && 'total' in result) {
          numericResult = (result as any).total;
        } else {
          logger.error('[MessageListContainer] Invalid result type:', result);
          return;
        }

        // Complete this roll (marks it done in the batch)
        completeDiceRoll(currentRoll.id, { total: numericResult });

        // Check if this was the last roll in the batch
        // Use setTimeout to allow state to settle after completeDiceRoll
        setTimeout(async () => {
          if (isBatchComplete()) {
            logger.info('[MessageListContainer] Batch complete (manual), sending combined roll results');

            // Get all completed rolls from this batch
            const batchResults = getBatchResults();

            // Format all roll results into a single message
            const rollTexts = batchResults.map(roll => {
              const total = roll.result?.total ?? 0;
              const dc = roll.dc;
              const ac = roll.ac;
              const success = dc ? total >= dc : ac ? total >= ac : null;
              const successText = success !== null ? (success ? '✓' : '✗') : '';
              return `${roll.description}: ${total} ${successText}`;
            });

            const combinedText = rollTexts.join('\n');

            const playerMessage: ChatMessage = {
              text: combinedText,
              sender: 'player',
              timestamp: new Date().toISOString(),
              context: {
                intent: 'dice_roll',
                diceRoll: {
                  total: numericResult,
                  timestamp: new Date().toISOString(),
                  // Include all batch results for AI context
                  batchResults: batchResults.map(r => ({
                    description: r.description,
                    total: r.result?.total,
                    dc: r.dc,
                    ac: r.ac,
                    success: r.dc ? (r.result?.total ?? 0) >= r.dc : r.ac ? (r.result?.total ?? 0) >= r.ac : null,
                  })),
                },
              },
            };

            if (onSendFullMessage) {
              await onSendFullMessage(combinedText);
            } else {
              await onSendMessage(playerMessage);
            }

            // Clear the batch state
            clearBatch();
          } else {
            logger.info('[MessageListContainer] Batch not complete (manual), waiting for more rolls');
          }
        }, 50); // Small delay to let state update
      } catch (error) {
        handleAsyncError(error, {
          userMessage: 'Failed to process dice result',
          context: { location: 'MessageListContainer.handleManualResult' },
        });
      }
    },
    [onSendMessage, onSendFullMessage, getCurrentDiceRoll, completeDiceRoll, isBatchComplete, getBatchResults, clearBatch],
  );

  return (
    <>
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
            {!group.isPlayer ? (
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
                    expandedMessages={expandedMessages}
                    setExpandedMessages={setExpandedMessages}
                    dynamicOptions={dynamicOptions}
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
      {(() => {
        const currentRoll = getCurrentDiceRoll();
        if (!currentRoll) return null;

        return (
          <div
            className={`fixed bottom-24 left-1/2 transform -translate-x-1/2 z-[${Z_INDEX.POPOVER}]`}
          >
            <DiceRollRequest
              request={{
                type: currentRoll.requestType as any,
                formula: `${currentRoll.rollConfig.count}d${currentRoll.rollConfig.dieType}${currentRoll.rollConfig.modifier >= 0 ? '+' : ''}${currentRoll.rollConfig.modifier}`,
                purpose: currentRoll.description,
                advantage: currentRoll.rollConfig.advantage,
                disadvantage: currentRoll.rollConfig.disadvantage,
              }}
              onRoll={handleDiceRoll}
              onManualResult={handleManualResult}
              onCancel={() => cancelDiceRoll(currentRoll.id)}
              className="shadow-2xl animate-in slide-in-from-bottom-4 duration-300"
            />
          </div>
        );
      })()}

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
};
