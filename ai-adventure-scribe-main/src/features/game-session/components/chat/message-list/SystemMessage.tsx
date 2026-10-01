import React from 'react';

import { MessageMetadata } from './MessageMetadata';
import { useShowTargetNumbers } from '../../../hooks/use-show-target-numbers';
import { EngineResultCardView } from '../../game/EngineResultCardView';

import type { ChatMessage } from '@/types/game';

import { isEngineResultCard } from '@/services/combat/engine-result-card';

interface SystemMessageProps {
  message: ChatMessage;
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
  displayText: string;
}

/** Explicitly renders engine/local notices instead of routing them through a player bubble. */
export const SystemMessage: React.FC<SystemMessageProps> = React.memo(
  ({ message, isFirstInGroup, isLastInGroup, displayText }) => {
    const { showTargetNumbers } = useShowTargetNumbers();
    const cards = Array.isArray(message.context?.engineCards)
      ? message.context.engineCards.filter(isEngineResultCard)
      : [];
    // A paragraph a card stands for is not printed twice; any other keeps its text.
    const rest = cards.length
      ? (message.text ?? '')
          .split('\n\n')
          .filter(
            (paragraph) =>
              paragraph.trim() &&
              !cards.some(
                (card) => paragraph.includes(card.line) || card.covers?.includes(paragraph),
              ),
          )
          .join('\n\n')
      : displayText;
    return (
      <div
        role="status"
        aria-label="System message"
        className="w-full rounded-xl border border-infinite-gold/30 bg-card/70 px-4 py-3 text-sm text-muted-foreground shadow-sm"
      >
        {cards.map((card, index) => (
          <EngineResultCardView
            key={`${index}-${card.line}`}
            card={card}
            showTargetNumbers={showTargetNumbers}
          />
        ))}
        {rest.length > 0 && <div className="whitespace-pre-wrap leading-relaxed">{rest}</div>}
        <MessageMetadata
          message={message}
          isFirstInGroup={isFirstInGroup}
          isLastInGroup={isLastInGroup}
          isPlayer={false}
        />
      </div>
    );
  },
);
