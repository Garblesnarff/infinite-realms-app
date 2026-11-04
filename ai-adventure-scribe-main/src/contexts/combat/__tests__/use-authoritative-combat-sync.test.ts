import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { fetchWithAuthMock } = vi.hoisted(() => ({ fetchWithAuthMock: vi.fn() }));

vi.mock('@/infrastructure/api/rest-client', () => ({
  fetchWithAuth: fetchWithAuthMock,
  SessionExpiredError: class SessionExpiredError extends Error {
    constructor() {
      super('Session expired — sign in again');
      this.name = 'SessionExpiredError';
    }
  },
}));

vi.mock('@/infrastructure/api/request-id-log', () => ({
  logServerRequestId: vi.fn(),
}));

import {
  readAuthoritativeCombat,
  useAuthoritativeCombatSync,
} from '../use-authoritative-combat-sync';

describe('readAuthoritativeCombat auth recovery (#1190)', () => {
  it('uses the shared auth client for a poller read so a 401 can refresh and retry once', async () => {
    const signal = new AbortController().signal;
    fetchWithAuthMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ combatEntryPending: { id: 'entry-1' } }),
    });

    await expect(readAuthoritativeCombat('session with spaces', signal)).resolves.toEqual({
      state: 'none',
      pending: { id: 'entry-1' },
    });
    expect(fetchWithAuthMock).toHaveBeenCalledWith(
      '/v1/combat/sessions/session%20with%20spaces/active',
      { signal },
    );
  });

  it('does not turn a terminal refresh rejection into an unknown combat state', async () => {
    const expired = new (await import('@/infrastructure/api/rest-client')).SessionExpiredError();
    fetchWithAuthMock.mockRejectedValue(expired);

    await expect(readAuthoritativeCombat('session-1')).rejects.toBe(expired);
  });
});

describe('#1357 session-socket-reconnected re-reads the board once', () => {
  const boardPath = '/v1/combat/sessions/session-1/active';

  it('re-reads the board once per reconnect event and stops after unmount', async () => {
    fetchWithAuthMock.mockClear();
    fetchWithAuthMock.mockResolvedValue({ ok: false, status: 404 });
    const dispatch = vi.fn();
    const getEncounter = (): null => null;

    const { unmount } = renderHook(() =>
      useAuthoritativeCombatSync('session-1', dispatch, getEncounter),
    );
    // The mount read runs once; the reconnect assertions below count from here.
    await act(async () => undefined);
    const boardReads = (): number =>
      fetchWithAuthMock.mock.calls.filter(([path]) => path === boardPath).length;
    const readsAfterMount = boardReads();
    expect(readsAfterMount).toBe(1);

    await act(async () => {
      window.dispatchEvent(new CustomEvent('session-socket-reconnected'));
      await Promise.resolve();
    });
    expect(boardReads()).toBe(readsAfterMount + 1);

    unmount();
    await act(async () => {
      window.dispatchEvent(new CustomEvent('session-socket-reconnected'));
      await Promise.resolve();
    });
    expect(boardReads()).toBe(readsAfterMount + 1);
  });
});
