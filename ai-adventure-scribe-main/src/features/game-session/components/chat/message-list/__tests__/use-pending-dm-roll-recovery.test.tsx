import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { processAiResponse, gameState, useGame } = vi.hoisted(() => {
  const process = vi.fn();
  const state = { diceRollQueue: { pendingRolls: [] as Array<{ status: string }> } };
  const useGameMock = vi.fn(() => ({ state, processAiResponse: process }));
  return { processAiResponse: process, gameState: state, useGame: useGameMock };
});

vi.mock('@/contexts/GameContext', () => ({ useGame }));

import { usePendingDmRollRecovery } from '../use-pending-dm-roll-recovery';

import type { ChatMessage } from '@/types/game';

describe('usePendingDmRollRecovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gameState.diceRollQueue.pendingRolls = [];
  });

  const stealthRequest = {
    type: 'skill_check' as const,
    formula: '1d20+5',
    purpose: 'Stealth check',
    dc: 13,
  };

  it('restores a pending Stealth popup once after persisted messages finish loading', async () => {
    const messages: ChatMessage[] = [
      {
        id: 'dm-stealth-request',
        text: '',
        sender: 'dm',
        context: { intent: 'pending_roll_request', rollRequests: [stealthRequest] },
      },
    ];
    const props = { sessionId: 'session-1', messages, messagesReady: false };
    const { rerender } = renderHook((input) => usePendingDmRollRecovery(input), {
      initialProps: props,
    });

    expect(processAiResponse).not.toHaveBeenCalled();
    rerender({ ...props, messagesReady: true });

    await waitFor(() => expect(processAiResponse).toHaveBeenCalledTimes(1));
    expect(processAiResponse).toHaveBeenCalledWith([
      { ...stealthRequest, rollRequestId: 'dm-stealth-request:roll:0' },
    ]);
    rerender({ ...props, messagesReady: true });
    expect(processAiResponse).toHaveBeenCalledTimes(1);
  });

  it('does not restore the request after the player has sent another message', () => {
    const messages: ChatMessage[] = [
      {
        id: 'dm-stealth-request',
        text: '',
        sender: 'dm',
        rollRequests: [stealthRequest],
      },
      { id: 'player-moved-on', text: 'I move through the doorway.', sender: 'player' },
    ];

    renderHook(() =>
      usePendingDmRollRecovery({ sessionId: 'session-1', messages, messagesReady: true }),
    );

    expect(processAiResponse).not.toHaveBeenCalled();
  });

  it('never restores an engine-owned combat attack roll', () => {
    const messages: ChatMessage[] = [
      {
        id: 'dm-combat-attack',
        text: '',
        sender: 'dm',
        rollRequests: [
          { type: 'attack', formula: '1d20+5', purpose: 'Longsword attack vs Bandit' },
          { type: 'initiative', formula: '1d20+1', purpose: 'Initiative for the party' },
        ],
      },
    ];

    renderHook(() =>
      usePendingDmRollRecovery({ sessionId: 'session-1', messages, messagesReady: true }),
    );

    expect(processAiResponse).not.toHaveBeenCalled();
  });
});
