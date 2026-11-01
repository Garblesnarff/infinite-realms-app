/**
 * #1315 done-means 3 — when a turn times out while a pending combat entry
 * was received, the previous DM message's options come back so another
 * option can be picked instead of Retry on the same action. Today they stay
 * disabled (the failed player message is latest) until Retry.
 */
import { act, render, screen } from '@testing-library/react';
import React, { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageListContainer } from '../MessageListContainer';

import type { ChatMessage } from '@/types/game';

import { CharacterProvider } from '@/contexts/CharacterContext';
import { CombatProvider } from '@/contexts/CombatContext';

vi.mock('@/contexts/GameContext', () => ({
  useGame: () => ({
    state: { diceRollQueue: { pendingRolls: [] }, currentPhase: 'exploration' },
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
    pendingRollId: null,
    rollError: null,
  }),
}));
vi.mock('../DMMessage', () => ({
  DMMessage: ({ displayContent }: { displayContent: string }) => <p>{displayContent}</p>,
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/combat/use-player-roll-host', () => ({ usePlayerRollHost: vi.fn() }));
vi.mock('@/services/auth/TokenService', async (importOriginal) =>
  (await import('@/test/token-service-mock')).createTokenServiceMock(importOriginal, {
    getAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer <redacted>' })),
    getAccessToken: vi.fn(() => 'test'),
  }),
);

const SESSION_ID = 'session-1315';

const MESSAGES: ChatMessage[] = [
  {
    id: 'dm-1',
    sender: 'dm',
    text:
      'The Gilded Sailors turn toward you.\n\nWhat would you like to do?\n\n' +
      'A. **Turn and Face the Gilded Sailors**, blades out.\n' +
      'B. **Slip away quietly**, into the dark.\n' +
      'C. **Call out to the crew**, asking for parley.',
  },
  { id: 'p-1', sender: 'player', text: 'Turn and Face the Gilded Sailors' },
];

const list = (timedOutWithPendingEntry: boolean): React.ReactElement => (
  <CharacterProvider>
    <CombatProvider sessionId={SESSION_ID}>
      <MessageListContainer
        messages={MESSAGES}
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
        sessionId={SESSION_ID}
        messagesReady
        timedOutWithPendingEntry={timedOutWithPendingEntry}
      />
    </CombatProvider>
  </CharacterProvider>
);

const settle = async (): Promise<void> => {
  for (let pass = 0; pass < 2; pass += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11_000);
    });
  }
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('options after a timeout with a pending entry (#1315)', () => {
  it('keeps the previous options disabled on an ordinary failed turn', async () => {
    render(list(false));
    await settle();
    expect(screen.getByRole('button', { name: /Slip away quietly/i })).toBeDisabled();
  });

  it('re-enables the previous options after a timeout with a pending entry', async () => {
    render(list(true));
    await settle();
    expect(screen.getByRole('button', { name: /Slip away quietly/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Call out to the crew/i })).toBeEnabled();
  });
});
