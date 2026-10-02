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
  loadCachedSession: loadCachedSessionMock,
  persistSession: persistSessionMock,
  refreshAccessTokenOnce: refreshMock,
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
});
