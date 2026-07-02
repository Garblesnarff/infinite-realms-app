import React from 'react';

import { DMMessage } from './DMMessage';
import { DynamicOptionsSection } from './DynamicOptionsSection';
import { PlayerMessage } from './PlayerMessage';

import type { ChatMessage } from '@/types/game';

import {
  CombatMessage,
  CombatSummaryMessage,
  type CombatMessageData,
} from '@/components/combat/CombatMessage';
import { InitiativeMessage } from '@/components/combat/messages/InitiativeMessage';
import { DiceRollMessage } from '@/components/game/DiceRollMessage';
import { parseMessageOptions } from '@/utils/parseMessageOptions';

interface MessageRendererProps {
  message: ChatMessage;
  messageId: string;
  groupIndex: number;
  msgIndex: number;
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
  isPlayer: boolean;
  isDM: boolean;
  expandedMessages: Set<string>;
  setExpandedMessages: React.Dispatch<React.SetStateAction<Set<string>>>;
  dynamicOptions: { key: string; lines: string[] } | null;
  imageByMessage: Record<string, { url: string; prompt: string }>;
  generatingFor: Set<string>;
  genErrorByMessage: Record<string, string>;
  onGenerateScene: (message: ChatMessage & { id?: string; timestamp?: string }) => Promise<void>;
  onOptionSelect: (optionText: string) => Promise<void>;
  characterName?: string;
}

/**
 * MessageRenderer Component
 * Renders individual messages with proper delegation to DMMessage or PlayerMessage
 * Handles special message types (dice rolls, combat)
 */
export const MessageRenderer: React.FC<MessageRendererProps> = React.memo(
  ({
    message,
    messageId,
    isFirstInGroup,
    isLastInGroup,
    isPlayer,
    isDM,
    expandedMessages,
    setExpandedMessages,
    dynamicOptions,
    imageByMessage,
    generatingFor,
    genErrorByMessage,
    onGenerateScene,
    onOptionSelect,
    characterName: _characterName,
  }) => {
    // Compose display text with dynamic options overlay (DM last-in-group only)
    const shouldOverlay = isDM && isLastInGroup && dynamicOptions?.key === messageId;
    const messageWithOverlay =
      shouldOverlay && dynamicOptions?.lines?.length
        ? `${message.text}\n${dynamicOptions.lines.join('\n')}`
        : message.text;

    // Parse for this message (using overlay text when present)
    const parsedMessage = isDM ? parseMessageOptions(messageWithOverlay) : null;

    // Truncation logic
    const baseText = parsedMessage
      ? parsedMessage.content || messageWithOverlay
      : messageWithOverlay;
    const isLongMessage = baseText.length > 200;
    const isExpanded = expandedMessages.has(messageId);
    const displayText =
      isLongMessage && !isExpanded ? `${baseText.substring(0, 200)}... ` : baseText;

    const toggleExpanded = () => {
      setExpandedMessages((prev) => {
        const newSet = new Set(prev);
        if (newSet.has(messageId)) {
          newSet.delete(messageId);
        } else {
          newSet.add(messageId);
        }
        return newSet;
      });
    };

    // Image presence (persisted or ephemeral) for DM messages
    const hasMessageImages = isDM && Array.isArray(message.images) && message.images.length > 0;
    const firstMessageImgUrl = hasMessageImages ? message.images[0]?.url : undefined;
    const ephemeralImgUrl = isDM && !hasMessageImages ? imageByMessage[messageId]?.url : undefined;

    return (
      <div
        id={`m-${messageId}`}
        data-anchor={isDM ? 'true' : 'false'}
        className={`w-full ${isFirstInGroup ? '' : 'mt-1'}`}
      >
        {/* Special message types */}
        {message.context?.diceRoll ? (
          <div className="w-full">
            <DiceRollMessage data={message.context.diceRoll} playerName={isPlayer ? 'You' : 'DM'} />
          </div>
        ) : message.context?.combatData ? (
          <div className="w-full">
            {message.context.combatData.type === 'initiative' ? (
              <InitiativeMessage
                participants={message.context.combatData.participants || []}
                timestamp={
                  message.timestamp
                    ? new Date(message.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : undefined
                }
              />
            ) : message.context.combatData.summary ? (
              <CombatSummaryMessage
                summary={message.context.combatData.summary}
                timestamp={
                  message.timestamp
                    ? new Date(message.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : undefined
                }
              />
            ) : (
              <CombatMessage
                data={message.context.combatData as CombatMessageData}
                timestamp={
                  message.timestamp
                    ? new Date(message.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : undefined
                }
              />
            )}
          </div>
        ) : isDM ? (
          <DMMessage
            message={message}
            messageId={messageId}
            isFirstInGroup={isFirstInGroup}
            isLastInGroup={isLastInGroup}
            displayContent={
              parsedMessage ? parsedMessage.content || messageWithOverlay : messageWithOverlay
            }
            isExpanded={isExpanded}
            onToggleExpanded={toggleExpanded}
            imageUrl={firstMessageImgUrl || ephemeralImgUrl}
            isGeneratingImage={generatingFor.has(messageId)}
            imageError={genErrorByMessage[messageId]}
            onGenerateImage={() => onGenerateScene(message)}
          />
        ) : (
          <PlayerMessage
            message={message}
            messageId={messageId}
            isFirstInGroup={isFirstInGroup}
            isLastInGroup={isLastInGroup}
            displayText={displayText}
            isLongMessage={isLongMessage}
            isExpanded={isExpanded}
            onToggleExpanded={toggleExpanded}
          />
        )}

        {/* Action Options - render inline for DM bubbles on last message */}
        {isLastInGroup && isDM && parsedMessage && parsedMessage.hasOptions && (
          <DynamicOptionsSection
            options={parsedMessage.options}
            onOptionSelect={onOptionSelect}
            hasDynamicOverlay={dynamicOptions?.key === messageId}
          />
        )}
      </div>
    );
  },
  (prev, next) => {
    // Return true if props are equal (prevents re-render)
    // Standard props check - skip collections which are checked specifically below
    const basicPropsMatch =
      prev.message === next.message &&
      prev.messageId === next.messageId &&
      prev.isFirstInGroup === next.isFirstInGroup &&
      prev.isLastInGroup === next.isLastInGroup &&
      prev.isPlayer === next.isPlayer &&
      prev.isDM === next.isDM &&
      prev.characterName === next.characterName &&
      prev.onGenerateScene === next.onGenerateScene &&
      prev.onOptionSelect === next.onOptionSelect;

    if (!basicPropsMatch) return false;

    // Optimized check for collection-based props to avoid re-renders when OTHER messages change
    // We only care if the state relevant to THIS specific message has changed
    const expandedMatch =
      prev.expandedMessages.has(prev.messageId) === next.expandedMessages.has(next.messageId);
    const generatingMatch =
      prev.generatingFor.has(prev.messageId) === next.generatingFor.has(next.messageId);
    const imageMatch = prev.imageByMessage[prev.messageId] === next.imageByMessage[next.messageId];
    const errorMatch =
      prev.genErrorByMessage[prev.messageId] === next.genErrorByMessage[next.messageId];

    // dynamicOptions only affects the last DM message in a group if it matches this messageId
    const prevWasOverlay =
      prev.isDM && prev.isLastInGroup && prev.dynamicOptions?.key === prev.messageId;
    const nextIsOverlay =
      next.isDM && next.isLastInGroup && next.dynamicOptions?.key === next.messageId;

    let dynamicOptionsMatch = true;
    if (prevWasOverlay || nextIsOverlay) {
      dynamicOptionsMatch = prev.dynamicOptions === next.dynamicOptions;
    }

    return expandedMatch && generatingMatch && imageMatch && errorMatch && dynamicOptionsMatch;
  },
);
