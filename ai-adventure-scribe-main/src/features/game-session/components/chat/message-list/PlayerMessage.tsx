import React from 'react';

import { MessageMetadata } from './MessageMetadata';

import type { ChatMessage } from '@/types/game';

import { Button } from '@/components/ui/button';

interface PlayerMessageProps {
  message: ChatMessage;
  messageId: string;
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
  displayText: string;
  isLongMessage: boolean;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  /** The player's character name for the "You · {name}" label. */
  characterName?: string;
  /** Retry the failed send; the row clears when the retry starts. */
  onRetrySend?: () => void | Promise<void>;
}

/**
 * PlayerMessage Component
 * Renders player-specific message bubbles with card styling.
 *
 * #88: the bubble is a right-aligned hug-to-content block (max 60ch) — the
 * group column right-aligns it, so no ml-auto. A send the server never
 * recorded (message.context.sendFailed, set by the message queue) renders
 * dashed with a "Not sent." row and a Try again button instead of vanishing.
 */
export const PlayerMessage: React.FC<PlayerMessageProps> = React.memo(
  ({
    message,
    messageId: _messageId,
    isFirstInGroup,
    isLastInGroup,
    displayText,
    isLongMessage,
    isExpanded,
    onToggleExpanded,
    characterName,
    onRetrySend,
  }) => {
    const isFailedSend = message.context?.sendFailed === true;
    return (
      <div className="flex w-full flex-col items-end">
        {/* #88: label above the bubble, first in group only. */}
        {/* Same 12px floor as the DM label (strategist queue 03:15Z), not the ticket's 11px. */}
        {isFirstInGroup && (
          <div className="mb-1 text-xs font-semibold uppercase tracking-[.1em] text-ir-steel-text">
            {characterName ? `You · ${characterName}` : 'You'}
          </div>
        )}
        <div
          className={
            `relative px-3.5 py-2.5 rounded-2xl rounded-tr-[4px] transition-all duration-300 message-bubble backdrop-blur-sm ` +
            (isFailedSend
              ? // NOTE: the ticket's `border-[color:var(--ir-hp-bad)]/60` does NOT
                // generate under Tailwind 3.4 (the /NN modifier on an arbitrary
                // var() color is silently dropped — EngineLine's identical class
                // is broken on main today). The explicit color-mix form below
                // is the pattern CampaignDetailPage already uses, and it does.
                'border border-dashed border-[color:color-mix(in_srgb,var(--ir-hp-bad)_60%,transparent)] '
              : 'border border-[rgba(95,113,168,.45)] ') +
            'bg-[color:var(--ir-player)] text-[15px] leading-[1.55] max-w-[60ch] ' +
            'animate-in fade-in slide-in-from-bottom-2 group-hover:shadow-lg'
          }
        >
          {/* Message content */}
          <div className="whitespace-pre-wrap break-words">{displayText}</div>

          {/* Truncation expander */}
          {isLongMessage && (
            <button
              onClick={onToggleExpanded}
              className="text-xs text-primary hover:underline mt-1 inline-block"
            >
              {isExpanded ? 'Read less' : 'Read more'}
            </button>
          )}

          {/* Metadata (context and timestamp) */}
          <MessageMetadata
            message={message}
            isFirstInGroup={isFirstInGroup}
            isLastInGroup={isLastInGroup}
            isPlayer={true}
          />
        </div>

        {/* #88: failed sends stay visible with a retry instead of vanishing. */}
        {isFailedSend && (
          <div className="mt-1 flex items-center justify-end gap-2">
            <span className="text-xs text-ir-hp-bad">Not sent.</span>
            <Button variant="outline" size="sm" onClick={() => void onRetrySend?.()}>
              Try again
            </Button>
          </div>
        )}
      </div>
    );
  },
);
