/**
 * #2280: a reload with a DM reply whose narrative roll is unanswered. The saved row carries the
 * prose and the roll requests together; the list withholds the prose, the popup comes back once,
 * and the prose appears once the player's roll is in. Replays the run 11 and M5 turn-1 shapes.
 */
import { render, screen } from '@testing-library/react';
import React, { createRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DM_ROLL_REPLY_TURNS,
  RUN_11_INSIGHT,
} from '../../../../../../../shared/test-fixtures/dm-roll-reply-saves';
import { MessageListContainer } from '../MessageListContainer';

import type { ChatMessage } from '@/types/game';

const { processAiResponse } = vi.hoisted(() => ({ processAiResponse: vi.fn() }));

vi.mock('@/contexts/CombatContext', () => ({
  useCombat: () => ({ state: { activeEncounter: null }, refreshCombatState: vi.fn() }),
}));
vi.mock('@/contexts/GameContext', () => ({
  useGame: () => ({ state: { diceRollQueue: { pendingRolls: [] } }, processAiResponse }),
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
  MessageRenderer: ({ message }: { message: ChatMessage }) => <p>{message.text}</p>,
}));

const list = (messages: ChatMessage[], messagesReady = true): React.ReactElement => (
  <MessageListContainer
    messages={messages}
    messagesRef={createRef<HTMLDivElement>()}
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
    messagesReady={messagesReady}
  />
);

describe('reload with an unanswered narrative roll (#2280)', () => {
  beforeEach(() => {
    processAiResponse.mockClear();
  });

  for (const turn of DM_ROLL_REPLY_TURNS) {
    it(`${turn.name}: prose withheld, popup restored once, prose shown after the roll`, () => {
      // The rows exactly as the history endpoint hydrates them (see use-messages).
      const player: ChatMessage = { id: 'p1', sender: 'player', text: turn.playerInput };
      const reply: ChatMessage = {
        id: turn.dmMessageId,
        sender: 'dm',
        text: turn.reply.text,
        context: turn.wireBody.context as ChatMessage['context'],
        rollRequests: turn.rollRequests,
      };

      const { rerender } = render(list([player, reply], false));
      expect(processAiResponse).not.toHaveBeenCalled();

      rerender(list([player, reply]));
      expect(screen.getByText(turn.playerInput)).toBeInTheDocument();
      expect(screen.queryByText(turn.reply.text)).not.toBeInTheDocument();
      expect(processAiResponse).toHaveBeenCalledTimes(1);
      expect(processAiResponse).toHaveBeenCalledWith(turn.rollRequests);

      // A refetch of the same page does not queue it again.
      rerender(list([player, { ...reply }]));
      expect(processAiResponse).toHaveBeenCalledTimes(1);

      // The player's roll lands: the reply's prose is now part of the story.
      const roll: ChatMessage = {
        id: 'p2',
        sender: 'player',
        text: `${turn.rollRequests[0]?.purpose}: 7 (nat 6+1)`,
        context: { intent: 'dice_roll' },
      };
      rerender(list([player, reply, roll]));
      expect(screen.getByText(turn.reply.text)).toBeInTheDocument();
      expect(processAiResponse).toHaveBeenCalledTimes(1);
    });
  }

  it('a reply that asked for a roll during this visit is never re-opened by recovery', () => {
    const turn = RUN_11_INSIGHT;
    const opening: ChatMessage = { id: 'dm-0', sender: 'dm', text: 'The Eternal Feast opens.' };
    const { rerender } = render(list([opening]));
    expect(processAiResponse).not.toHaveBeenCalled();

    // Turn 1 happens live; the player then dismisses the roll, emptying the queue.
    rerender(
      list([
        opening,
        { id: 'p1', sender: 'player', text: turn.playerInput },
        {
          id: turn.dmMessageId,
          sender: 'dm',
          text: turn.reply.text,
          rollRequests: turn.rollRequests,
        },
      ]),
    );
    expect(processAiResponse).not.toHaveBeenCalled();
    expect(screen.queryByText(turn.reply.text)).not.toBeInTheDocument();
  });
});

describe('DM reply rendering', () => {
  it('shows each paragraph of one reply once when a later player message arrives', () => {
    const paragraphOne = 'The archway groans open.';
    const paragraphTwo = 'Dust rolls across the floor.';
    render(
      list([
        { id: 'player-1', sender: 'player', text: 'I push the door.' },
        { id: 'dm-1', sender: 'dm', text: `${paragraphOne}\n\n${paragraphTwo}` },
        { id: 'player-2', sender: 'player', text: 'I step inside.' },
      ]),
    );

    const replyText = `${paragraphOne}\n\n${paragraphTwo}`;
    const renderedReplyParagraphs = [...document.querySelectorAll('p')].filter(
      (paragraph) => paragraph.textContent === replyText,
    );
    expect(renderedReplyParagraphs).toHaveLength(1);
  });
});
