import React from 'react';

import type { ChatMessage } from '@/types/game';

interface CompanionMessageProps {
  message: ChatMessage;
  displayText: string;
}

export const CompanionMessage: React.FC<CompanionMessageProps> = ({ message, displayText }) => {
  const name = message.speakerName ?? message.characterName ?? 'Companion';
  const timestamp = message.timestamp
    ? new Date(message.timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  return (
    <div className="w-full">
      <article
        aria-label={`${name} companion message`}
        className="companion-bubble max-w-[min(42rem,90vw)] rounded-2xl rounded-tl-sm border border-infinite-teal/50 bg-infinite-teal/10 px-4 py-3 shadow-sm"
      >
        <header className="mb-1.5 flex items-center gap-2">
          <span className="truncate text-xs font-semibold text-infinite-teal">{name}</span>
          <span className="rounded-full border border-infinite-teal/40 px-1.5 py-0.5 text-[9px] font-bold tracking-[0.14em] text-infinite-teal">
            COMPANION
          </span>
        </header>
        <p className="whitespace-pre-wrap break-words text-sm text-foreground/90">{displayText}</p>
      </article>
      {timestamp && (
        <div className="mt-1 text-left text-[10px] text-muted-foreground">{timestamp}</div>
      )}
    </div>
  );
};
