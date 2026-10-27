import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { readAuthoritativeCombatMock, useCombatMock } = vi.hoisted(() => ({
  readAuthoritativeCombatMock: vi.fn(),
  useCombatMock: vi.fn(),
}));

vi.mock('@/contexts/combat/use-authoritative-combat-sync', () => ({
  readAuthoritativeCombat: readAuthoritativeCombatMock,
}));

vi.mock('@/contexts/CombatContext', () => ({
  useCombat: useCombatMock,
}));

vi.mock('@/services/combat/combat-entry-delivery', () => ({
  combatEntryTurnConfirmed: vi.fn(() => false),
  currentCombatEntryPlayer: vi.fn(() => ({ id: 'player-1' })),
  onCombatEntryPlayerSourceChange: vi.fn(() => () => undefined),
  startCombatEntryDelivery: vi.fn(),
}));

vi.mock('@/infrastructure/api/rest-client', () => ({
  SessionExpiredError: class SessionExpiredError extends Error {
    constructor() {
      super('Session expired — sign in again');
      this.name = 'SessionExpiredError';
    }
  },
}));

vi.mock('@/lib/logger', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { usePendingCombatEntryOffer } from '../use-pending-combat-entry-offer';

import { SessionExpiredError } from '@/infrastructure/api/rest-client';

describe('usePendingCombatEntryOffer session end (#1200)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    useCombatMock.mockReturnValue({ state: { activeEncounter: null } });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('stops polling when a poll rejects with SessionExpiredError', async () => {
    const rejections: unknown[] = [];
    const onRejection = (event: PromiseRejectionEvent): void => {
      rejections.push(event.reason);
    };
    window.addEventListener('unhandledrejection', onRejection);
    try {
      readAuthoritativeCombatMock.mockRejectedValue(new SessionExpiredError());
      const { unmount } = renderHook(() => usePendingCombatEntryOffer('session-1'));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });

      // The first poll ran on mount; the interval must not fire again.
      expect(readAuthoritativeCombatMock).toHaveBeenCalledTimes(1);
      expect(readAuthoritativeCombatMock).toHaveBeenCalledWith('session-1');
      expect(rejections).toEqual([]);
      unmount();
    } finally {
      window.removeEventListener('unhandledrejection', onRejection);
    }
  });

  it('keeps polling while reads resolve unknown', async () => {
    readAuthoritativeCombatMock.mockResolvedValue({ state: 'unknown' });
    const { unmount } = renderHook(() => usePendingCombatEntryOffer('session-1'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    // Initial poll + two interval polls.
    expect(readAuthoritativeCombatMock).toHaveBeenCalledTimes(3);
    unmount();
  });

  it('keeps polling after a request-timeout AbortError', async () => {
    // readAuthoritativeCombat rethrows the timeout AbortError, which is not
    // a session end: the poll logs it and carries on.
    const timeout = new Error('The request was aborted.');
    timeout.name = 'AbortError';
    readAuthoritativeCombatMock.mockRejectedValue(timeout);
    const { unmount } = renderHook(() => usePendingCombatEntryOffer('session-1'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(readAuthoritativeCombatMock).toHaveBeenCalledTimes(3);
    unmount();
  });
});
