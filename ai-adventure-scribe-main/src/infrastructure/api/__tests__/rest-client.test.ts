import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { accessToken, fetchMock, loadCachedSessionMock, persistSessionMock, refreshMock } =
  vi.hoisted(() => ({
    accessToken: { value: 'old-access' },
    fetchMock: vi.fn(),
    loadCachedSessionMock: vi.fn(),
    persistSessionMock: vi.fn(),
    refreshMock: vi.fn(),
  }));

vi.mock('@/lib/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/services/auth/TokenService', () => ({
  getAuthHeaders: vi.fn(() => ({ Authorization: `Bearer ${accessToken.value}` })),
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
  isNetworkError,
  SessionExpiredError,
  subscribeToNetworkRetry,
} from '../rest-client';

import logger from '@/lib/logger';

const response = (status: number, body: Record<string, unknown> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('fetchWithAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    accessToken.value = 'old-access';
    loadCachedSessionMock.mockReturnValue({
      access_token: 'old-access',
      refresh_token: 'refresh-token',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries network failures with backoff and returns the successful response', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(response(200, { ok: true }));
    const retryStates: boolean[] = [];
    const unsubscribe = subscribeToNetworkRetry((isRetrying) => retryStates.push(isRetrying));

    const request = fetchWithAuth('/v1/sessions/session-1/messages', { method: 'POST' });
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(request).resolves.toMatchObject({ status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(retryStates).toEqual([false, true, false]);
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(
      isNetworkError(
        new Error('Failed to get DM response - AI service unavailable', {
          cause: new TypeError('Failed to fetch'),
        }),
      ),
    ).toBe(true);
    unsubscribe();
  });

  it('stops retrying after the network budget and leaves non-network errors alone', async () => {
    vi.useFakeTimers();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const request = fetchWithAuth('/v1/sessions/session-1/messages', { method: 'POST' });
    const rejection = expect(request).rejects.toThrow('Failed to fetch');
    for (const delayMs of [1_000, 2_000, 4_000, 8_000, 5_000]) {
      await vi.advanceTimersByTimeAsync(delayMs);
    }

    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(isNetworkError(new TypeError('invalid request argument'))).toBe(false);
  });

  it('stops retrying after a custom retryBudgetMs of waits', async () => {
    vi.useFakeTimers();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const request = fetchWithAuth('/v1/llm/extract', { retryBudgetMs: 5_000 });
    const rejection = expect(request).rejects.toThrow('Failed to fetch');
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(2_000);

    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('does not retry an HTTP error response', async () => {
    fetchMock.mockResolvedValueOnce(response(503));

    await expect(
      fetchWithAuth('/v1/sessions/session-1/messages', { method: 'POST' }),
    ).resolves.toMatchObject({
      status: 503,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes once and retries a 401 with the new Authorization header', async () => {
    fetchMock.mockResolvedValueOnce(response(401, { error: 'Unauthorized' }));
    fetchMock.mockResolvedValueOnce(response(200, { ok: true }));
    refreshMock.mockResolvedValue({ accessToken: 'new-access', refreshToken: 'new-refresh' });

    await expect(fetchWithAuth('/v1/combat/sessions/session-1/enter')).resolves.toMatchObject({
      status: 200,
    });

    expect(refreshMock).toHaveBeenCalledWith('refresh-token', 'old-access');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      Authorization: 'Bearer old-access',
    });
    expect(fetchMock.mock.calls[1][1].headers).toMatchObject({
      Authorization: 'Bearer new-access',
    });
    expect(logger.info).toHaveBeenCalledWith('AUTH_RETRY_AFTER_401', {
      route: '/v1/combat/sessions/session-1/enter',
      outcome: 'retry_succeeded',
    });
  });

  it('refreshes and retries a 401 from the combat poller route', async () => {
    fetchMock.mockResolvedValueOnce(response(401, { error: 'Unauthorized' }));
    fetchMock.mockResolvedValueOnce(response(200, { combat: { id: 'encounter-1' } }));
    refreshMock.mockResolvedValue({ accessToken: 'new-access', refreshToken: 'new-refresh' });

    await expect(
      fetchWithAuth('/v1/combat/sessions/session-1/active', {
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ status: 200 });

    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/v1/combat/sessions/session-1/active');
    expect(fetchMock.mock.calls[1][1].headers).toMatchObject({
      Authorization: 'Bearer new-access',
    });
  });

  it('refreshes and retries an expired token on the combat intent POST', async () => {
    fetchMock.mockResolvedValueOnce(response(401, { error: 'Unauthorized' }));
    fetchMock.mockResolvedValueOnce(response(200, { accepted: true }));
    refreshMock.mockResolvedValue({ accessToken: 'new-access', refreshToken: 'new-refresh' });
    const body = JSON.stringify({ intent: { type: 'attack', actorId: 'pc-1' }, source: 'player' });

    await expect(
      fetchWithAuth('/v1/combat/session-1/intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }),
    ).resolves.toMatchObject({ status: 200 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', body });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'POST', body });
    expect(fetchMock.mock.calls[1][1].headers).toMatchObject({
      Authorization: 'Bearer new-access',
    });
  });

  it('refreshes a token within two minutes of expiry before sending the request', async () => {
    const exp = Math.floor(Date.now() / 1000) + 30;
    const expiringToken = `header.${btoa(JSON.stringify({ exp }))}.signature`;
    accessToken.value = expiringToken;
    loadCachedSessionMock.mockReturnValue({
      access_token: expiringToken,
      refresh_token: 'refresh-token',
    });
    refreshMock.mockResolvedValue({ accessToken: 'fresh-access', refreshToken: 'fresh-refresh' });
    fetchMock.mockResolvedValueOnce(response(200, { ok: true }));

    await expect(fetchWithAuth('/v1/sessions/session-1')).resolves.toMatchObject({ status: 200 });

    expect(refreshMock).toHaveBeenCalledWith('refresh-token', expiringToken);
    expect(persistSessionMock).toHaveBeenCalledWith({
      access_token: 'fresh-access',
      refresh_token: 'fresh-refresh',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      Authorization: 'Bearer fresh-access',
    });
  });

  it('surfaces a typed session error when the pre-request refresh fails', async () => {
    const exp = Math.floor(Date.now() / 1000) + 30;
    const expiringToken = `header.${btoa(JSON.stringify({ exp }))}.signature`;
    loadCachedSessionMock.mockReturnValue({
      access_token: expiringToken,
      refresh_token: 'refresh-token',
    });
    refreshMock.mockResolvedValue(null);

    await expect(fetchWithAuth('/v1/sessions/session-1')).rejects.toBeInstanceOf(
      SessionExpiredError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces a typed session error when refresh fails', async () => {
    fetchMock.mockResolvedValueOnce(response(401));
    refreshMock.mockResolvedValue(null);

    await expect(fetchWithAuth('/v1/llm/generate')).rejects.toBeInstanceOf(SessionExpiredError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith('AUTH_RETRY_AFTER_401', {
      route: '/v1/llm/generate',
      outcome: 'refresh_failed',
    });
  });

  it('surfaces a typed session error when the retry is also unauthorized', async () => {
    fetchMock.mockResolvedValueOnce(response(401));
    fetchMock.mockResolvedValueOnce(response(401));
    refreshMock.mockResolvedValue({ accessToken: 'new-access', refreshToken: 'new-refresh' });

    await expect(fetchWithAuth('/v1/llm/extract')).rejects.toBeInstanceOf(SessionExpiredError);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith('AUTH_RETRY_AFTER_401', {
      route: '/v1/llm/extract',
      outcome: 'session_expired',
    });
  });

  it('rethrows a transport failure from the refresh endpoint instead of reporting session-expired (#565)', async () => {
    const { TokenRefreshTransportError } = await import('@/services/auth/TokenService');
    fetchMock.mockResolvedValueOnce(response(401));
    refreshMock.mockRejectedValue(new TokenRefreshTransportError());

    await expect(fetchWithAuth('/v1/characters')).rejects.toBeInstanceOf(
      TokenRefreshTransportError,
    );
    expect(logger.warn).not.toHaveBeenCalledWith(
      'AUTH_RETRY_AFTER_401',
      expect.objectContaining({ outcome: 'refresh_failed' }),
    );
  });

  /** A fetch mock that hangs like a blackholed connection, but honors aborts like a real fetch. */
  const blackholedFetch = (): void => {
    fetchMock.mockImplementation(
      (_input: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal as AbortSignal | undefined;
          const onAbort = (): void =>
            reject(new DOMException('The request was aborted.', 'AbortError'));
          if (signal?.aborted) {
            onAbort();
          } else {
            signal?.addEventListener('abort', onAbort, { once: true });
          }
        }),
    );
  };

  it('aborts a hung request on a default route after 30 s (#565)', async () => {
    vi.useFakeTimers();
    try {
      blackholedFetch();

      const request = fetchWithAuth('/v1/characters', { method: 'POST' });
      const rejection = expect(request).rejects.toMatchObject({ name: 'AbortError' });
      await vi.advanceTimersByTimeAsync(30_000);
      await rejection;
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the 90 s ceiling for /v1/llm/generate (#565)', async () => {
    vi.useFakeTimers();
    try {
      blackholedFetch();

      const request = fetchWithAuth('/v1/llm/generate', { method: 'POST' });
      const rejection = expect(request).rejects.toMatchObject({ name: 'AbortError' });
      let settled = false;
      void request.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      await vi.advanceTimersByTimeAsync(30_000);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(60_000);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves memory-extraction jobs without a ceiling (#2148, #565)', async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockReturnValue(new Promise(() => {})); // hangs

      const request = fetchWithAuth('/v1/memory-extraction/jobs', { method: 'POST' });
      let settled = false;
      void request.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      await vi.advanceTimersByTimeAsync(180_000);
      expect(settled).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves image generation without a ceiling (#565)', async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockReturnValue(new Promise(() => {})); // hangs

      const request = fetchWithAuth('/v1/images/generate', { method: 'POST' });
      let settled = false;
      void request.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      await vi.advanceTimersByTimeAsync(180_000);
      expect(settled).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
