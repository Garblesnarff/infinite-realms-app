import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock, loadCachedSessionMock, persistSessionMock, refreshMock, completion } =
  vi.hoisted(() => ({
    fetchMock: vi.fn(),
    loadCachedSessionMock: vi.fn(),
    persistSessionMock: vi.fn(),
    refreshMock: vi.fn(),
    // Stands in for TokenService's shared record of the last completed refresh.
    completion: { at: null as number | null },
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
  getLastRefreshCompletedAt: () => completion.at,
  // Mirrors TokenService: a refresh that yields a token pair records completion.
  refreshAccessTokenOnce: async (...args: unknown[]): Promise<unknown> => {
    const tokens = await refreshMock(...args);
    if (tokens) completion.at = Date.now();
    return tokens;
  },
  TokenRefreshTransportError: class TokenRefreshTransportError extends Error {
    constructor(message = 'Token refresh endpoint unreachable') {
      super(message);
      this.name = 'TokenRefreshTransportError';
    }
  },
}));

import { fetchWithAuth, REFRESH_RETRY_GRACE_MS, SessionExpiredError } from '../rest-client';

import { refreshAccessTokenOnce } from '@/services/auth/TokenService';

const ROUTE = '/v1/llm/extract';

const response = (status: number): Response =>
  new Response(JSON.stringify({}), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const authOf = (callIndex: number): string | undefined =>
  (fetchMock.mock.calls[callIndex][1].headers as Record<string, string> | undefined)?.Authorization;

/**
 * Starts a request that was sent with the old token and holds its response
 * open. The caller decides when its 401 lands.
 */
async function startRequestWithOldToken(): Promise<{
  pending: Promise<Response>;
  answerWith: (r: Response) => void;
}> {
  let answerWith!: (r: Response) => void;
  fetchMock.mockReturnValueOnce(
    new Promise<Response>((resolve) => {
      answerWith = resolve;
    }),
  );
  const pending = fetchWithAuth(ROUTE);
  await vi.advanceTimersByTimeAsync(0);
  return { pending, answerWith };
}

/** Another path (timer, page load, another 401) refreshes; the stored pair moves on. */
async function refreshCompletesElsewhere(): Promise<void> {
  loadCachedSessionMock.mockReturnValue({
    access_token: 'new-access',
    refresh_token: 'new-refresh',
  });
  await refreshAccessTokenOnce('refresh-token', 'old-access');
}

describe('fetchWithAuth refresh grace window (#1113)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
    completion.at = null;
    vi.stubGlobal('fetch', fetchMock);
    loadCachedSessionMock.mockReturnValue({
      access_token: 'old-access',
      refresh_token: 'refresh-token',
    });
    refreshMock.mockResolvedValue({ accessToken: 'new-access', refreshToken: 'new-refresh' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries an in-flight 401 once with the stored token, without a second refresh', async () => {
    const { pending, answerWith } = await startRequestWithOldToken();
    await refreshCompletesElsewhere();
    expect(refreshMock).toHaveBeenCalledTimes(1);

    // The request sent with the old token now gets its 401, 3 s after the refresh.
    vi.advanceTimersByTime(3_000);
    fetchMock.mockResolvedValueOnce(response(200));
    answerWith(response(401));

    await expect(pending).resolves.toMatchObject({ status: 200 });
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authOf(1)).toBe('Bearer new-access');
  });

  it('surfaces a session error if the grace retry is also unauthorized, without refreshing', async () => {
    const { pending, answerWith } = await startRequestWithOldToken();
    await refreshCompletesElsewhere();

    fetchMock.mockResolvedValueOnce(response(401));
    answerWith(response(401));

    await expect(pending).rejects.toBeInstanceOf(SessionExpiredError);
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refreshes again when the 401 arrives after the grace window has passed', async () => {
    const { pending, answerWith } = await startRequestWithOldToken();
    await refreshCompletesElsewhere();
    expect(refreshMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(REFRESH_RETRY_GRACE_MS + 1_000);
    refreshMock.mockResolvedValueOnce({
      accessToken: 'newer-access',
      refreshToken: 'newer-refresh',
    });
    fetchMock.mockResolvedValueOnce(response(200));
    answerWith(response(401));

    await expect(pending).resolves.toMatchObject({ status: 200 });
    expect(refreshMock).toHaveBeenCalledTimes(2);
    expect(authOf(1)).toBe('Bearer newer-access');
  });

  it('still grants grace at exactly the window edge', async () => {
    const { pending, answerWith } = await startRequestWithOldToken();
    await refreshCompletesElsewhere();

    vi.advanceTimersByTime(REFRESH_RETRY_GRACE_MS);
    fetchMock.mockResolvedValueOnce(response(200));
    answerWith(response(401));

    await expect(pending).resolves.toMatchObject({ status: 200 });
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('does not take grace when the failed request already carried the current token', async () => {
    // A refresh finished before this request, and the stored pair is the one
    // the request sends. A 401 here is a real auth failure: refresh as before.
    await refreshCompletesElsewhere();
    expect(refreshMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValueOnce(response(401));
    fetchMock.mockResolvedValueOnce(response(200));

    await expect(fetchWithAuth(ROUTE)).resolves.toMatchObject({ status: 200 });

    expect(refreshMock).toHaveBeenCalledTimes(2);
    expect(authOf(1)).toBe('Bearer new-access');
  });

  it('refreshes on a 401 when no refresh has completed yet (normal case)', async () => {
    fetchMock.mockResolvedValueOnce(response(401));
    fetchMock.mockResolvedValueOnce(response(200));

    await expect(fetchWithAuth(ROUTE)).resolves.toMatchObject({ status: 200 });

    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(refreshMock).toHaveBeenCalledWith('refresh-token', 'old-access');
  });
});
