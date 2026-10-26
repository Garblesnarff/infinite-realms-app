import React from 'react';

import { CombatRoundDivider } from './CombatRoundDivider';
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
  previousEngineKey?: string;
}

/** Intents the system posts when something went wrong (dice errors, turn recovery). */
function isErrorSystemMessage(message: ChatMessage): boolean {
  const intent = message.context?.intent;
  return intent === 'error_recovery' || (typeof intent === 'string' && intent.endsWith('_error'));
}

/**
 * #88: a system line is a hairline rule, not a boxed card — short status text
 * centers between hairlines, errors render in the hp-bad error variant.
 * Engine cards and the round divider keep rendering above the text as before.
 * Long multi-paragraph text (e.g. the safety X-CARD) keeps a readable block:
 * uppercasing it into a hairline would mangle safety-critical copy.
 */
export const SystemMessage: React.FC<SystemMessageProps> = React.memo(
  ({ message, isFirstInGroup, isLastInGroup, displayText, previousEngineKey }) => {
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
    const isError = isErrorSystemMessage(message);
    const isShortStatus = rest.length > 0 && rest.length <= 160 && !rest.includes('\n\n');
    return (
      <div role={isError ? 'alert' : 'status'} aria-label="System message" className="w-full">
        {message.context?.intent === 'combat_npc_result' &&
          typeof message.context.round === 'number' &&
          previousEngineKey !==
            `${message.context.round}|${message.context.combatEngineBlocks?.[0]?.actor}` && (
            <CombatRoundDivider
              round={message.context.round}
              actor={message.context.combatEngineBlocks?.[0]?.actor as string}
            />
          )}
        {cards.map((card, index) => (
          <EngineResultCardView
            key={`${index}-${card.line}`}
            card={card}
            showTargetNumbers={showTargetNumbers}
          />
        ))}
        {rest.length > 0 &&
          (isShortStatus ? (
            <div
              className={
                isError
                  ? 'flex items-center gap-2.5 normal-case tracking-normal text-[13px] text-ir-hp-bad'
                  : 'flex items-center gap-2.5 text-xs font-medium uppercase tracking-[.06em] text-muted-foreground'
              }
            >
              <span
                aria-hidden
                className={
                  // NOTE: the ticket's `bg-[color:var(--ir-hp-bad)]/35` does NOT
                  // generate under Tailwind 3.4 (see PlayerMessage); the
                  // explicit color-mix form is the proven equivalent.
                  isError
                    ? 'h-px flex-1 bg-[color:color-mix(in_srgb,var(--ir-hp-bad)_35%,transparent)]'
                    : 'h-px flex-1 bg-white/10'
                }
              />
              <span className="whitespace-pre-wrap break-words">{rest}</span>
              <span
                aria-hidden
                className={
                  isError
                    ? 'h-px flex-1 bg-[color:color-mix(in_srgb,var(--ir-hp-bad)_35%,transparent)]'
                    : 'h-px flex-1 bg-white/10'
                }
              />
            </div>
          ) : (
            <div className="whitespace-pre-wrap break-words leading-relaxed text-sm text-muted-foreground">
              {rest}
            </div>
          ))}
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
