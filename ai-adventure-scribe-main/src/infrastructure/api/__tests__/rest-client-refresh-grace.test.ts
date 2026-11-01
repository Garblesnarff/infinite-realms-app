import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock, loadCachedSessionMock, persistSessionMock, refreshMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  loadCachedSessionMock: vi.fn(),
  persistSessionMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/services/auth/TokenService', () => ({
  getAuthHeaders: vi.fn(() => ({})),
  markSessionEnded: vi.fn(),
  SESSION_ENDED_MESSAGE: 'Your sign-in expired — sign in again; your game is saved',
  loadCachedSession: loadCachedSessionMock,
  persistSession: persistSessionMock,
  refreshAccessTokenOnce: refreshMock,
  TokenRefreshTransportError: class TokenRefreshTransportError extends Error {
    constructor(message = 'Token refresh endpoint unreachable') {
      super(message);
      this.name = 'TokenRefreshTransportError';
    }
  },
}));

import {
  fetchWithAuth,
  REFRESH_RETRY_GRACE_MS,
  resetRefreshGraceForTests,
  SessionExpiredError,
} from '../rest-client';

const ROUTE = '/v1/llm/extract';

const response = (status: number): Response =>
  new Response(JSON.stringify({}), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const authOf = (callIndex: number): string | undefined =>
  (fetchMock.mock.calls[callIndex][1].headers as Record<string, string> | undefined)?.Authorization;

describe('fetchWithAuth refresh grace window (#1113)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
    resetRefreshGraceForTests();
    vi.stubGlobal('fetch', fetchMock);
    loadCachedSessionMock.mockReturnValue({
      access_token: 'old-access',
      refresh_token: 'refresh-token',
    });
    refreshMock.mockResolvedValue({ accessToken: 'new-access', refreshToken: 'new-refresh' });
  });

  afterEach(() => {
    resetRefreshGraceForTests();
    vi.useRealTimers();
  });

  it('retries once with the stored token and does not refresh again inside the grace window', async () => {
    // First request: 401, refresh completes, retry succeeds.
    fetchMock.mockResolvedValueOnce(response(401));
    fetchMock.mockResolvedValueOnce(response(200));
    await expect(fetchWithAuth(ROUTE)).resolves.toMatchObject({ status: 200 });
    expect(refreshMock).toHaveBeenCalledTimes(1);

    // A second request was already in flight with the old token. Its 401
    // arrives 3 s after the refresh finished, and the stored session now
    // holds the rotated pair.
    loadCachedSessionMock.mockReturnValue({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
    });
    vi.advanceTimersByTime(3_000);
    fetchMock.mockResolvedValueOnce(response(401));
    fetchMock.mockResolvedValueOnce(response(200));

    await expect(fetchWithAuth(ROUTE)).resolves.toMatchObject({ status: 200 });

    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(authOf(3)).toBe('Bearer new-access');
  });

  it('surfaces a session error if the grace retry is also unauthorized, without refreshing', async () => {
    fetchMock.mockResolvedValueOnce(response(401));
    fetchMock.mockResolvedValueOnce(response(200));
    await fetchWithAuth(ROUTE);
    expect(refreshMock).toHaveBeenCalledTimes(1);

    loadCachedSessionMock.mockReturnValue({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
    });
    fetchMock.mockResolvedValueOnce(response(401));
    fetchMock.mockResolvedValueOnce(response(401));

    await expect(fetchWithAuth(ROUTE)).rejects.toBeInstanceOf(SessionExpiredError);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes normally when a 401 arrives after the grace window has passed', async () => {
    fetchMock.mockResolvedValueOnce(response(401));
    fetchMock.mockResolvedValueOnce(response(200));
    await fetchWithAuth(ROUTE);
    expect(refreshMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(REFRESH_RETRY_GRACE_MS + 1_000);
    refreshMock.mockResolvedValueOnce({
      accessToken: 'newer-access',
      refreshToken: 'newer-refresh',
    });
    fetchMock.mockResolvedValueOnce(response(401));
    fetchMock.mockResolvedValueOnce(response(200));

    await expect(fetchWithAuth(ROUTE)).resolves.toMatchObject({ status: 200 });

    expect(refreshMock).toHaveBeenCalledTimes(2);
    expect(authOf(3)).toBe('Bearer newer-access');
  });

  it('refreshes on a 401 when no refresh has completed yet (normal case)', async () => {
    fetchMock.mockResolvedValueOnce(response(401));
    fetchMock.mockResolvedValueOnce(response(200));

    await expect(fetchWithAuth(ROUTE)).resolves.toMatchObject({ status: 200 });

    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(refreshMock).toHaveBeenCalledWith('refresh-token', 'old-access');
  });

  it('a 401 exactly at the window edge is still inside the grace window', async () => {
    fetchMock.mockResolvedValueOnce(response(401));
    fetchMock.mockResolvedValueOnce(response(200));
    await fetchWithAuth(ROUTE);

    loadCachedSessionMock.mockReturnValue({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
    });
    vi.advanceTimersByTime(REFRESH_RETRY_GRACE_MS);
    fetchMock.mockResolvedValueOnce(response(401));
    fetchMock.mockResolvedValueOnce(response(200));

    await expect(fetchWithAuth(ROUTE)).resolves.toMatchObject({ status: 200 });
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});
