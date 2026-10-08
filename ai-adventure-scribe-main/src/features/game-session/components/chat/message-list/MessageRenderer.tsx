import React from 'react';

import { CompanionMessage } from './CompanionMessage';
import { DMMessage } from './DMMessage';
import { DynamicOptionsSection } from './DynamicOptionsSection';
import { PlayerMessage } from './PlayerMessage';
import { SystemMessage } from './SystemMessage';

import type { ChatMessage } from '@/types/game';

import {
  CombatMessage,
  CombatSummaryMessage,
  type CombatMessageData,
} from '@/components/combat/CombatMessage';
import { InitiativeMessage } from '@/components/combat/messages/InitiativeMessage';
import { DiceRollMessage } from '@/components/game/DiceRollMessage';
import { withoutSpellCastTag } from '@/services/combat/declared-player-spell';
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
  isCompanion: boolean;
  expandedMessages: Set<string>;
  setExpandedMessages: React.Dispatch<React.SetStateAction<Set<string>>>;
  imageByMessage: Record<string, { url: string; prompt: string }>;
  generatingFor: Set<string>;
  genErrorByMessage: Record<string, string>;
  onGenerateScene: (message: ChatMessage & { id?: string; timestamp?: string }) => Promise<void>;
  onOptionSelect: (optionText: string) => Promise<void>;
  onSendMessage?: (message: ChatMessage) => Promise<void>;
  characterName?: string;
  /** The divider key of the last engine block printed before this message (#2417). */
  previousEngineKey?: string;
  /** Keep the current player's combat menu mounted after a DM notice without inline options. */
  combatOptionsVisible?: boolean;
  /**
   * Only the newest message carries the live combat menu. An earlier group shows the options the
   * DM saved with it, whatever the game mode is now (#2641).
   */
  isLatestMessage?: boolean;
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
    isCompanion,
    expandedMessages,
    setExpandedMessages,
    imageByMessage,
    generatingFor,
    genErrorByMessage,
    onGenerateScene,
    onOptionSelect,
    onSendMessage,
    characterName: _characterName,
    previousEngineKey,
    combatOptionsVisible = false,
    isLatestMessage = true,
  }) => {
    // Parse for this message
    const parsedMessage = isDM ? parseMessageOptions(message.text) : null;

    // Truncation logic
    const baseText = parsedMessage
      ? parsedMessage.content || message.text
      : message.sender === 'player'
        ? withoutSpellCastTag(message.text)
        : message.text;
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
    const firstMessageImgUrl = hasMessageImages ? message.images?.[0]?.url : undefined;
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
        ) : message.sender === 'system' || (message.sender === 'player' && !isPlayer) ? (
          <SystemMessage
            message={message}
            isFirstInGroup={isFirstInGroup}
            isLastInGroup={isLastInGroup}
            displayText={displayText}
            previousEngineKey={previousEngineKey}
          />
        ) : isDM ? (
          <DMMessage
            message={message}
            messageId={messageId}
            isFirstInGroup={isFirstInGroup}
            isLastInGroup={isLastInGroup}
            displayContent={parsedMessage ? parsedMessage.content || message.text : message.text}
            isExpanded={isExpanded}
            onToggleExpanded={toggleExpanded}
            imageUrl={firstMessageImgUrl || ephemeralImgUrl}
            isGeneratingImage={generatingFor.has(messageId)}
            imageError={genErrorByMessage[messageId]}
            onGenerateImage={() => onGenerateScene(message)}
            previousEngineKey={previousEngineKey}
          />
        ) : isCompanion ? (
          <CompanionMessage message={message} displayText={displayText} />
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
        {isLastInGroup &&
          (isDM || combatOptionsVisible) &&
          (parsedMessage?.hasOptions || combatOptionsVisible) && (
            <DynamicOptionsSection
              options={parsedMessage?.options ?? []}
              onOptionSelect={onOptionSelect}
              onSendMessage={onSendMessage}
              hasDynamicOverlay={false}
              isLatest={isLatestMessage}
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
      prev.isCompanion === next.isCompanion &&
      prev.characterName === next.characterName &&
      prev.previousEngineKey === next.previousEngineKey &&
      prev.onGenerateScene === next.onGenerateScene &&
      prev.onOptionSelect === next.onOptionSelect;

    if (prev.onSendMessage !== next.onSendMessage) return false;

    if (
      !basicPropsMatch ||
      prev.combatOptionsVisible !== next.combatOptionsVisible ||
      prev.isLatestMessage !== next.isLatestMessage
    ) {
      return false;
    }

    // Optimized check for collection-based props to avoid re-renders when OTHER messages change
    // We only care if the state relevant to THIS specific message has changed
    const expandedMatch =
      prev.expandedMessages.has(prev.messageId) === next.expandedMessages.has(next.messageId);
    const generatingMatch =
      prev.generatingFor.has(prev.messageId) === next.generatingFor.has(next.messageId);
    const imageMatch = prev.imageByMessage[prev.messageId] === next.imageByMessage[next.messageId];
    const errorMatch =
      prev.genErrorByMessage[prev.messageId] === next.genErrorByMessage[next.messageId];

    return expandedMatch && generatingMatch && imageMatch && errorMatch;
  },
);
