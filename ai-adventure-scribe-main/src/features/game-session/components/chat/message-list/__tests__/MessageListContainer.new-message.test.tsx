import { fireEvent, render, screen } from '@testing-library/react';
import React, { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { MessageListContainer } from '../MessageListContainer';

import type { ChatMessage } from '@/types/game';

vi.mock('@/contexts/CombatContext', () => ({
  useCombat: () => ({
    state: { activeEncounter: null },
    refreshCombatState: vi.fn(),
  }),
}));

vi.mock('@/contexts/GameContext', () => ({
  useGame: () => ({
    state: { diceRollQueue: { pendingRolls: [] } },
    processAiResponse: vi.fn(),
  }),
}));

vi.mock('../use-message-dice-rolls', () => ({
  useMessageDiceRolls: () => ({
    currentRoll: null,
    batchProgress: null,
    rollRequest: null,
    handleManualResult: vi.fn(),
    handleCancelRoll: vi.fn(),
    lastRollRef: { current: null },
  }),
}));

vi.mock('@/hooks/combat/use-player-roll-host', () => ({ usePlayerRollHost: vi.fn() }));
vi.mock('../MessageRenderer', () => ({
  MessageRenderer: ({ message }: { message: ChatMessage }) => (
    <div data-testid="rendered-message">{message.text}</div>
  ),
}));

const dm = (id: string, text: string): ChatMessage => ({ id, text, sender: 'dm' });

const renderContainer = (
  props: Partial<React.ComponentProps<typeof MessageListContainer>> = {},
): ReturnType<typeof render> & {
  scrollEl: HTMLDivElement;
  scrollRef: React.RefObject<HTMLDivElement>;
} => {
  const scrollRef = createRef<HTMLDivElement>();
  const utils = render(
    <div ref={scrollRef}>
      <MessageListContainer
        messages={[]}
        messagesRef={scrollRef}
        expandedMessages={new Set()}
        setExpandedMessages={vi.fn()}
        imageByMessage={{}}
        generatingFor={new Set()}
        genErrorByMessage={{}}
        onGenerateScene={vi.fn().mockResolvedValue(undefined)}
        onOptionSelect={vi.fn().mockResolvedValue(undefined)}
        onSendMessage={vi.fn().mockResolvedValue(undefined)}
        onSendFullMessage={vi.fn().mockResolvedValue(undefined)}
        sessionId="session-1"
        {...props}
      />
    </div>,
  );
  const scrollEl = scrollRef.current as HTMLDivElement;
  Object.defineProperty(scrollEl, 'scrollHeight', { configurable: true, value: 1000 });
  Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: 300 });
  return { ...utils, scrollEl, scrollRef };
};

describe('MessageListContainer writing row and new-message pill (#88)', () => {
  it('shows the writing row at the stream bottom while the DM composes', () => {
    renderContainer({ messages: [dm('m1', 'Hello')], isDmWriting: true });

    const row = screen.getByTestId('dm-writing-row');
    expect(row).toHaveTextContent('Dungeon Master is writing…');
  });

  it('shows no writing row when the DM is not composing', () => {
    renderContainer({ messages: [dm('m1', 'Hello')] });

    expect(screen.queryByTestId('dm-writing-row')).not.toBeInTheDocument();
  });

  it('raises the pill when a new message lands while scrolled up, and the pill scrolls to it', () => {
    const { rerender, scrollEl, scrollRef } = renderContainer({ messages: [dm('m1', 'Hello')] });

    scrollEl.scrollTop = 0;
    fireEvent.scroll(scrollEl);
    rerender(
      <div ref={scrollRef}>
        <MessageListContainer
          messages={[dm('m1', 'Hello'), dm('m2', 'And then…')]}
          messagesRef={scrollRef}
          expandedMessages={new Set()}
          setExpandedMessages={vi.fn()}
          imageByMessage={{}}
          generatingFor={new Set()}
          genErrorByMessage={{}}
          onGenerateScene={vi.fn().mockResolvedValue(undefined)}
          onOptionSelect={vi.fn().mockResolvedValue(undefined)}
          onSendMessage={vi.fn().mockResolvedValue(undefined)}
          onSendFullMessage={vi.fn().mockResolvedValue(undefined)}
          sessionId="session-1"
        />
      </div>,
    );

    const pill = screen.getByText('New message ↓');
    expect(pill).toBeInTheDocument();

    scrollEl.scrollTo = vi.fn();
    fireEvent.click(pill);
    expect(scrollEl.scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: 'smooth' });
    expect(screen.queryByText('New message ↓')).not.toBeInTheDocument();
  });

  it('shows no pill when the player sits within 120 px of the bottom', () => {
    const { rerender, scrollEl, scrollRef } = renderContainer({ messages: [dm('m1', 'Hello')] });

    scrollEl.scrollTop = 650; // 1000 - 650 - 300 = 50 px from the bottom
    fireEvent.scroll(scrollEl);
    rerender(
      <div ref={scrollRef}>
        <MessageListContainer
          messages={[dm('m1', 'Hello'), dm('m2', 'And then…')]}
          messagesRef={scrollRef}
          expandedMessages={new Set()}
          setExpandedMessages={vi.fn()}
          imageByMessage={{}}
          generatingFor={new Set()}
          genErrorByMessage={{}}
          onGenerateScene={vi.fn().mockResolvedValue(undefined)}
          onOptionSelect={vi.fn().mockResolvedValue(undefined)}
          onSendMessage={vi.fn().mockResolvedValue(undefined)}
          onSendFullMessage={vi.fn().mockResolvedValue(undefined)}
          sessionId="session-1"
        />
      </div>,
    );

    expect(screen.queryByText('New message ↓')).not.toBeInTheDocument();
  });

  it('shows no pill when the message list itself has not grown', () => {
    const { rerender, scrollEl, scrollRef } = renderContainer({ messages: [dm('m1', 'Hello')] });

    scrollEl.scrollTop = 0;
    fireEvent.scroll(scrollEl);
    rerender(
      <div ref={scrollRef}>
        <MessageListContainer
          messages={[dm('m1', 'Hello')]}
          messagesRef={scrollRef}
          expandedMessages={new Set()}
          setExpandedMessages={vi.fn()}
          imageByMessage={{}}
          generatingFor={new Set()}
          genErrorByMessage={{}}
          onGenerateScene={vi.fn().mockResolvedValue(undefined)}
          onOptionSelect={vi.fn().mockResolvedValue(undefined)}
          onSendMessage={vi.fn().mockResolvedValue(undefined)}
          onSendFullMessage={vi.fn().mockResolvedValue(undefined)}
          sessionId="session-1"
        />
      </div>,
    );

    expect(screen.queryByText('New message ↓')).not.toBeInTheDocument();
  });

  it('renders failed sends after the real transcript and hides the empty state for them', () => {
    const onRetryFailed = vi.fn();
    renderContainer({
      messages: [],
      failedMessages: [{ text: 'Failed hello', sender: 'player', context: { sendFailed: true } }],
      onRetryFailed,
    });

    expect(screen.getByText('Failed hello')).toBeInTheDocument();
    expect(screen.queryByText('Your adventure awaits...')).not.toBeInTheDocument();
  });
});
