import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useLiveDmFallbackPush } from '../use-live-dm-fallback-push';

import type { ChatMessage } from '@/types/game';

const mocks = vi.hoisted(() => ({
  processAiResponse: vi.fn(),
  pendingRolls: [] as Array<{ status: string }>,
}));

vi.mock('@/contexts/GameContext', () => ({
  useGame: () => ({
    processAiResponse: mocks.processAiResponse,
    state: { diceRollQueue: { pendingRolls: mocks.pendingRolls } },
  }),
}));

const sessionId = 'session-1';
const messageId = 'dm-1';
const requests = [{ type: 'check', purpose: 'Search the room', formula: '1d20' }];

function dispatchFallback(detail: Record<string, unknown>): void {
  act(() => {
    window.dispatchEvent(new CustomEvent('dm-fallback-persisted', { detail }));
  });
}

describe('useLiveDmFallbackPush (#800 item 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pendingRolls = [];
  });

  it('enqueues the rescued rolls with stable ids when the queue is empty', () => {
    renderHook(() => useLiveDmFallbackPush({ sessionId, messages: [] }));
    dispatchFallback({ sessionId, messageId, rollRequests: requests });
    expect(mocks.processAiResponse).toHaveBeenCalledTimes(1);
    const enqueued = mocks.processAiResponse.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({ type: 'check', purpose: 'Search the room' });
    expect(enqueued[0]?.rollRequestId).toBe(`${messageId}:roll:0`);
  });

  it('skips when a live queue already owns the slot', () => {
    mocks.pendingRolls = [{ status: 'pending' }];
    renderHook(() => useLiveDmFallbackPush({ sessionId, messages: [] }));
    dispatchFallback({ sessionId, messageId, rollRequests: requests });
    expect(mocks.processAiResponse).not.toHaveBeenCalled();
  });

  it('skips events for other sessions', () => {
    renderHook(() => useLiveDmFallbackPush({ sessionId, messages: [] }));
    dispatchFallback({ sessionId: 'session-2', messageId, rollRequests: requests });
    expect(mocks.processAiResponse).not.toHaveBeenCalled();
  });

  it('skips requests already answered by id-matched dice-roll or declined lines', () => {
    const messages = [
      {
        id: 'answer-1',
        sender: 'player',
        text: '14',
        timestamp: new Date().toISOString(),
        context: { intent: 'dice_roll', rollRequestId: `${messageId}:roll:0` },
      },
    ] as unknown as ChatMessage[];
    renderHook(() => useLiveDmFallbackPush({ sessionId, messages }));
    dispatchFallback({ sessionId, messageId, rollRequests: requests });
    expect(mocks.processAiResponse).not.toHaveBeenCalled();
  });

  it('enqueues only the still-owed requests from a batch', () => {
    const batch = [
      { type: 'check', purpose: 'First check', formula: '1d20' },
      { type: 'check', purpose: 'Second check', formula: '1d20' },
    ];
    const messages = [
      {
        id: 'answer-1',
        sender: 'system',
        text: 'You chose not to roll: First check.',
        timestamp: new Date().toISOString(),
        context: { intent: 'roll_declined', rollRequestId: `${messageId}:roll:0` },
      },
    ] as unknown as ChatMessage[];
    renderHook(() => useLiveDmFallbackPush({ sessionId, messages }));
    dispatchFallback({ sessionId, messageId, rollRequests: batch });
    expect(mocks.processAiResponse).toHaveBeenCalledTimes(1);
    const enqueued = mocks.processAiResponse.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]?.purpose).toBe('Second check');
    expect(enqueued[0]?.rollRequestId).toBe(`${messageId}:roll:1`);
  });

  it('drops engine-channel rolls and keeps narrative ids aligned with reload recovery', () => {
    const mixed = [
      { type: 'attack', purpose: 'Engine attack', formula: '1d20' },
      { type: 'check', purpose: 'Search the room', formula: '1d20' },
    ];
    renderHook(() => useLiveDmFallbackPush({ sessionId, messages: [] }));
    dispatchFallback({ sessionId, messageId, rollRequests: mixed });
    expect(mocks.processAiResponse).toHaveBeenCalledTimes(1);
    const enqueued = mocks.processAiResponse.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]?.purpose).toBe('Search the room');
    // Narrative index 0, not raw index 1: reload recovery assigns the same
    // id, so an existing answer for dm-1:roll:0 still matches.
    expect(enqueued[0]?.rollRequestId).toBe(`${messageId}:roll:0`);
  });

  it('drops entries without a string type', () => {
    const mixed = [
      { purpose: 'Typeless entry', formula: '1d20' },
      { type: 'check', purpose: 'Search the room', formula: '1d20' },
    ];
    renderHook(() => useLiveDmFallbackPush({ sessionId, messages: [] }));
    dispatchFallback({ sessionId, messageId, rollRequests: mixed });
    expect(mocks.processAiResponse).toHaveBeenCalledTimes(1);
    const enqueued = mocks.processAiResponse.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]?.rollRequestId).toBe(`${messageId}:roll:0`);
  });

  it('ignores malformed frames without throwing', () => {
    renderHook(() => useLiveDmFallbackPush({ sessionId, messages: [] }));
    expect(() => {
      dispatchFallback({ sessionId, messageId });
      dispatchFallback({ sessionId, messageId, rollRequests: 'not-an-array' });
      dispatchFallback({ sessionId, messageId, rollRequests: [null, 'nope'] });
    }).not.toThrow();
    expect(mocks.processAiResponse).not.toHaveBeenCalled();
  });
});
