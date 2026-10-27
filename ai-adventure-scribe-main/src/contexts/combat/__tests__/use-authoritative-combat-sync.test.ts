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

import { readAuthoritativeCombat } from '../use-authoritative-combat-sync';

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
