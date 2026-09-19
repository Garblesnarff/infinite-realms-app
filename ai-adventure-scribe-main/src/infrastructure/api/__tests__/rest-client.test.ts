import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { fetchWithAuth, SessionExpiredError } from '../rest-client';

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
