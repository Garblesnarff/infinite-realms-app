import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  STORY_SKILL_ROLL,
  STORY_SAVE_ROLL,
  storyDmBody,
  storySaveAnswerBody,
} from '../../../../../../../shared/test-fixtures/story-rolls';
import { useMessageDiceRolls } from '../use-message-dice-rolls';
import { usePendingDmRollRecovery } from '../use-pending-dm-roll-recovery';

import type { ChatMessage } from '@/types/game';

import { DiceRollRequest } from '@/components/game/DiceRollRequest';
import { CharacterProvider } from '@/contexts/CharacterContext';
import { CombatProvider } from '@/contexts/CombatContext';
import { GameProvider, useGame } from '@/contexts/GameContext';
import { ChatInput } from '@/features/game-session/components/chat/ChatInput';
import { currentQueueRoll } from '@/features/game-session/components/game/game-content/queue-roll-label';
import { RollTray } from '@/features/game-session/components/game/game-content/roll-tray-slot';
import { useHeldEntryRecovery } from '@/features/game-session/components/game/message/use-held-entry-recovery';
import { useMessageQueue } from '@/hooks/use-message-queue';
import { markAuthReady } from '@/lib/auth-gate';
import { withheldDmRollReplies } from '@/utils/dm-roll-recovery';

// Complete synthetic DM save body following useMessageQueue.
const dmBody = storyDmBody();
function readRow(body: Record<string, unknown>): ChatMessage {
  return {
    id: body.id as string,
    text: body.message as string,
    sender: body.speaker_type as ChatMessage['sender'],
    timestamp: body.timestamp as string,
    context: body.context as ChatMessage['context'],
  };
}

function Story({ rows, recover }: { rows: ChatMessage[]; recover: boolean }) {
  const game = useGame();
  const [interrupted, setInterrupted] = React.useState(false);
  const [messages, setMessages] = React.useState(rows);
  const { messageMutation } = useMessageQueue('story-session');
  usePendingDmRollRecovery({ sessionId: 'story-session', messages, messagesReady: true });
  const save = async (message: ChatMessage) => {
    await messageMutation.mutateAsync(message);
    setMessages((previous) => [...previous, message]);
  };
  const dice = useMessageDiceRolls({
    onSendMessage: save,
    onSendFullMessage: async (text, context) => {
      await save({
        text,
        sender: 'player',
        timestamp: new Date().toISOString(),
        context: context as ChatMessage['context'],
      });
      const response = await fetch('/story-dm-turn', { method: 'POST' });
      if (!response.ok) throw new Error('The DM could not answer — try again');
    },
  });
  useHeldEntryRecovery({
    sessionId: 'story-session',
    messages,
    messagesReady: recover,
    characterRecord: { id: 'test-character' },
    onUnansweredRoll: () => setInterrupted(true),
    resumeTurn: async () => {
      await fetch('/story-dm-turn', { method: 'POST' });
    },
  });
  const withheld = withheldDmRollReplies(messages);
  return (
    <>
      {messages
        .filter((message) => !withheld.has(message))
        .map((message, index) => (
          <p key={message.id ?? index}>{message.text}</p>
        ))}
      {dice.currentRoll && dice.rollRequest && (
        <RollTray>
          <DiceRollRequest
            key={dice.currentRoll.id}
            request={dice.rollRequest}
            requestId={dice.currentRoll.id}
            pendingRollId={dice.pendingRollId}
            rollError={dice.rollError}
            onResult={dice.handleManualResult}
            onCancel={dice.handleCancelRoll}
            onRetry={dice.handleRetryRoll}
            isRetrying={dice.isRetrying}
          />
        </RollTray>
      )}
      {dice.rollError && !dice.currentRoll && (
        <div role="alert">
          {dice.rollError}
          <button onClick={dice.handleRetryRoll}>Retry</button>
        </div>
      )}
      {interrupted && (
        <div role="alert">
          The DM turn was interrupted.{' '}
          <button
            onClick={async () => {
              await fetch('/story-dm-turn', { method: 'POST' });
              setInterrupted(false);
            }}
          >
            Retry
          </button>
        </div>
      )}
      <ChatInput
        onSendMessage={async () => undefined}
        isDisabled={Boolean(currentQueueRoll(game.state.diceRollQueue))}
      />
    </>
  );
}

function mount(rows: ChatMessage[], recover = false) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <CharacterProvider>
        <CombatProvider>
          <GameProvider>
            <Story rows={rows} recover={recover} />
          </GameProvider>
        </CombatProvider>
      </CharacterProvider>
    </QueryClientProvider>,
  );
}

async function answerRoll() {
  await screen.findByTestId('dice-roll-request');
  fireEvent.click(screen.getByRole('button', { name: /Enter my own roll/ }));
  fireEvent.change(screen.getByPlaceholderText('Enter total result...'), {
    target: { value: '8' },
  });
  fireEvent.click(screen.getByRole('button', { name: /^Submit$/ }));
}

describe('story roll recovery (#216)', () => {
  let saved: Record<string, unknown>[];
  let dmStatus: number;
  let serverRows: Record<string, unknown>[];
  let heldSave: Promise<Response> | null;
  let saveStatus: number;
  beforeEach(() => {
    markAuthReady();
    saved = [];
    dmStatus = 500;
    serverRows = [];
    heldSave = null;
    saveStatus = 200;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('/messages?'))
          return new Response(JSON.stringify({ total: serverRows.length, messages: serverRows }), {
            status: 200,
          });
        if (String(input) === '/story-dm-turn') return new Response('{}', { status: dmStatus });
        if (init?.method === 'POST' && init.body) {
          saved.push(JSON.parse(String(init.body)));
          if (heldSave) {
            const pending = heldSave;
            heldSave = null;
            return pending;
          }
          if (saveStatus !== 200) return new Response('{}', { status: saveStatus });
        }
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('a rejected send closes the tray, enables the composer and shows an error', async () => {
    mount([readRow(dmBody)]);
    await answerRoll();
    await screen.findByRole('alert');
    await waitFor(() => expect(screen.queryByTestId('roll-tray') === null).toBe(true), {
      onTimeout: (error) => error,
    });
    expect(screen.getByRole('textbox')).toBeEnabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/try again/i);
  });

  it('a DM-requested spell save releases the tray and offers Retry on failure', async () => {
    mount([readRow(storyDmBody(STORY_SAVE_ROLL))]);
    await answerRoll();
    await screen.findByRole('alert');
    await waitFor(() => expect(screen.queryByTestId('dice-roll-request') === null).toBe(true), {
      onTimeout: (error) => error,
    });
    expect(screen.getByRole('textbox')).toBeEnabled();
    expect(saved[0]).toEqual(
      storySaveAnswerBody(saved[0].id as string, saved[0].timestamp as string),
    );
    dmStatus = 200;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull(), {
      onTimeout: (error) => error,
    });
  });

  it('reload offers Retry for a persisted spell-save answer without saving it twice', async () => {
    dmStatus = 200;
    serverRows = [
      storySaveAnswerBody('33333333-3333-4333-8333-333333333333', '2026-01-01T00:00:01.000Z'),
    ];
    mount([readRow(storyDmBody(STORY_SAVE_ROLL)), ...serverRows.map(readRow)], true);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(
        vi.mocked(fetch).mock.calls.filter(([url]) => String(url) === '/story-dm-turn'),
      ).toHaveLength(1),
    );
    expect(saved).toHaveLength(0);
    expect(screen.queryByTestId('dice-roll-request')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeEnabled();
  });

  it('saves intermediate batch answers before allowing the final die to start the DM', async () => {
    dmStatus = 200;
    let release!: (response: Response) => void;
    heldSave = new Promise((resolve) => {
      release = resolve;
    });
    const request = STORY_SAVE_ROLL.rollRequests[0];
    const body = {
      ...storyDmBody(STORY_SAVE_ROLL),
      context: {
        ...storyDmBody(STORY_SAVE_ROLL).context,
        rollRequests: [request, { ...request, dc: 15 }],
      },
    };
    mount([readRow(body)]);
    await answerRoll();
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(screen.getByRole('button', { name: /Submit/ })).toBeInTheDocument();
    expect(
      vi.mocked(fetch).mock.calls.filter(([url]) => String(url) === '/story-dm-turn'),
    ).toHaveLength(0);
    release(new Response('{}', { status: 200 }));
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter total result...')).toBeNull());
    await answerRoll();
    await waitFor(() =>
      expect(
        vi.mocked(fetch).mock.calls.filter(([url]) => String(url) === '/story-dm-turn'),
      ).toHaveLength(1),
    );
    expect(saved).toHaveLength(2);
    expect(saved[0].context).toMatchObject({
      rollRequestId: `${STORY_SAVE_ROLL.dmMessageId}:roll:0`,
    });
    expect(saved[1].context).toMatchObject({
      rollRequestId: `${STORY_SAVE_ROLL.dmMessageId}:roll:1`,
    });
  });

  it('a failed intermediate save retries the same result and id before advancing the batch', async () => {
    dmStatus = 200;
    saveStatus = 422;
    const request = STORY_SAVE_ROLL.rollRequests[0];
    const body = {
      ...storyDmBody(STORY_SAVE_ROLL),
      context: {
        ...storyDmBody(STORY_SAVE_ROLL).context,
        rollRequests: [request, { ...request, dc: 15 }],
      },
    };
    mount([readRow(body)]);
    await answerRoll();
    const retry = await screen.findByRole('button', { name: 'Retry' });
    expect(
      vi.mocked(fetch).mock.calls.filter(([url]) => String(url) === '/story-dm-turn'),
    ).toHaveLength(0);
    saveStatus = 200;
    fireEvent.click(retry);
    await waitFor(() => expect(saved).toHaveLength(2));
    expect(saved[1]).toEqual(saved[0]);
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    await answerRoll();
    await waitFor(() =>
      expect(
        vi.mocked(fetch).mock.calls.filter(([url]) => String(url) === '/story-dm-turn'),
      ).toHaveLength(1),
    );
  });

  it('reload does not start the DM while a second distinct save remains unanswered', async () => {
    const answer = storySaveAnswerBody(
      '33333333-3333-4333-8333-333333333333',
      '2026-01-01T00:00:01.000Z',
    );
    serverRows = [answer];
    const request = STORY_SAVE_ROLL.rollRequests[0];
    const body = {
      ...storyDmBody(STORY_SAVE_ROLL),
      context: {
        ...storyDmBody(STORY_SAVE_ROLL).context,
        rollRequests: [request, { ...request, dc: 15 }],
      },
    };
    mount([readRow(body), readRow(answer)], true);
    await screen.findByTestId('dice-roll-request');
    expect(
      vi.mocked(fetch).mock.calls.filter(([url]) => String(url) === '/story-dm-turn'),
    ).toHaveLength(0);
    expect(saved).toHaveLength(0);
  });

  it('two saved requests collapsed to one tray do not restore a ghost roll on remount', async () => {
    dmStatus = 200;
    const requests = STORY_SKILL_ROLL.rollRequests;
    const duplicateBody = {
      ...dmBody,
      context: { ...(dmBody.context as object), rollRequests: [requests[0], { ...requests[0] }] },
    };
    const first = mount([readRow(duplicateBody)]);
    await answerRoll();
    await waitFor(() => expect(saved).toHaveLength(1));
    await waitFor(() => expect(screen.queryByTestId('roll-tray') === null).toBe(true), {
      onTimeout: (error) => error,
    });
    first.unmount();
    mount([readRow(duplicateBody), ...saved.map(readRow)]);
    await waitFor(() => expect(screen.getByRole('textbox').hasAttribute('disabled')).toBe(false), {
      onTimeout: (error) => error,
    });
    expect(screen.queryByTestId('roll-tray')).not.toBeInTheDocument();
    expect(screen.getByText(STORY_SKILL_ROLL.reply.text)).toBeInTheDocument();
  });
});
