import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getCharacterCombatStatusMock } = vi.hoisted(() => ({
  getCharacterCombatStatusMock: vi.fn(),
}));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: { getCharacterCombatStatus: getCharacterCombatStatusMock },
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

import { useCombatHP } from '../use-combat-hp';

import { SessionExpiredError } from '@/infrastructure/api/rest-client';

describe('useCombatHP session end (#1200)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('stops polling when a fetch rejects with SessionExpiredError', async () => {
    const rejections: unknown[] = [];
    const onRejection = (event: PromiseRejectionEvent): void => {
      rejections.push(event.reason);
    };
    window.addEventListener('unhandledrejection', onRejection);
    try {
      getCharacterCombatStatusMock.mockRejectedValue(new SessionExpiredError());
      const { result, unmount } = renderHook(() => useCombatHP('character-1'));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });

      // The first fetch ran on mount; the interval must not fire again.
      expect(getCharacterCombatStatusMock).toHaveBeenCalledTimes(1);
      expect(getCharacterCombatStatusMock).toHaveBeenCalledWith('character-1');
      expect(result.current).toBeNull();
      expect(rejections).toEqual([]);
      unmount();
    } finally {
      window.removeEventListener('unhandledrejection', onRejection);
    }
  });

  it('keeps polling after a non-session error and clears the value', async () => {
    getCharacterCombatStatusMock.mockRejectedValue(new Error('flaky network'));
    const { result, unmount } = renderHook(() => useCombatHP('character-1'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    // Initial fetch + two interval fetches: transient failures still retry.
    expect(getCharacterCombatStatusMock).toHaveBeenCalledTimes(3);
    expect(result.current).toBeNull();
    unmount();
  });

  it('maps a successful combat status and keeps polling', async () => {
    getCharacterCombatStatusMock.mockResolvedValue({
      current_hp: 12,
      max_hp: 20,
      temp_hp: 3,
      is_conscious: true,
    });
    const { result, unmount } = renderHook(() => useCombatHP('character-1'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(result.current).toEqual({
      current_hp: 12,
      max_hp: 20,
      temp_hp: 3,
      is_conscious: true,
    });
    expect(getCharacterCombatStatusMock).toHaveBeenCalledTimes(2);
    unmount();
  });
});
