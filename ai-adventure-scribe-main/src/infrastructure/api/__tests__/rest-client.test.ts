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

  it('a hung request on a default route aborts at the 10 s per-attempt timeout instead of the 30 s ceiling (#565, #51)', async () => {
    vi.useFakeTimers();
    try {
      blackholedFetch();

      const request = fetchWithAuth('/v1/characters', { method: 'POST' });
      const rejection = expect(request).rejects.toMatchObject({ name: 'AbortError' });
      // #51 changed what this pins: the old expectation was the 30 s
      // whole-request ceiling. The per-attempt timeout aborts at 10 s
      // instead — still exactly 1 call, because a timeout is never retried:
      // the server may still be executing, and resubmitting a POST in that
      // window risks double-applying it.
      await vi.advanceTimersByTimeAsync(10_000);
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

  it('retries a network error inside the budget and resends the same request (#51)', async () => {
    vi.useFakeTimers();
    try {
      // First attempt fails to connect; the retry succeeds. The retry is
      // the same submission (same init, same headers), so a server that
      // executed the first attempt dedups on the resent id.
      fetchMock
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce(response(200, { ok: true }));

      const request = fetchWithAuth('/v1/sessions/session-1/messages', { method: 'POST' });
      await vi.advanceTimersByTimeAsync(1_000);

      await expect(request).resolves.toMatchObject({ status: 200 });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      // The retry is the same submission, so the server sees identical
      // headers on both attempts — including the idempotency key.
      const firstInit = fetchMock.mock.calls.at(0)?.[1];
      const secondInit = fetchMock.mock.calls.at(1)?.[1];
      expect(firstInit).toBeDefined();
      expect(secondInit).toBeDefined();
      expect(secondInit?.headers).toEqual(firstInit?.headers);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry when a network error races the 10 s abort (#51)', async () => {
    vi.useFakeTimers();
    try {
      // The connection resets in the same tick the timer fires: the fetch
      // rejects with a TypeError, not an AbortError. The attempt still
      // exceeded its 10 s budget, so it must surface, not retry — the
      // server may still be executing.
      fetchMock.mockImplementationOnce(
        (_input: unknown, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            const signal = init?.signal as AbortSignal | undefined;
            const onAbort = (): void => reject(new TypeError('Failed to fetch'));
            if (signal?.aborted) {
              onAbort();
            } else {
              signal?.addEventListener('abort', onAbort, { once: true });
            }
          }),
      );

      const request = fetchWithAuth('/v1/sessions/session-1/messages', { method: 'POST' });
      const rejection = expect(request).rejects.toMatchObject({
        name: 'TypeError',
        message: 'Failed to fetch',
      });
      await vi.advanceTimersByTimeAsync(10_000);
      await rejection;
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not abort a hung /v1/llm/generate attempt at 10 s (#51)', async () => {
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
      // Past the per-attempt mark: still the first attempt, no retry.
      await vi.advanceTimersByTimeAsync(10_000);
      expect(settled).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      // The 90 s route ceiling still ends it.
      await vi.advanceTimersByTimeAsync(80_000);
      await rejection;
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry a hung attempt after its 10 s abort (#51)', async () => {
    vi.useFakeTimers();
    try {
      blackholedFetch();

      const request = fetchWithAuth('/v1/sessions/session-1/messages', { method: 'POST' });
      const rejection = expect(request).rejects.toMatchObject({ name: 'AbortError' });
      // Attempt 1 aborts at 10 s and the abort surfaces immediately — no
      // backoff, no second attempt. Resubmitting here could double-apply a
      // POST the server is still executing. Only `fetchWithAuth`'s internal
      // network-error retry reuses an id; a caller-level retry is a fresh
      // call with a fresh id.
      await vi.advanceTimersByTimeAsync(10_000);
      await rejection;
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends a keyless POST once on a network error — no blind retry of a DM turn (#1787)', async () => {
    vi.useFakeTimers();
    try {
      // /v1/llm/generate has no server-side dedup: a retried turn would
      // pay for the generation twice. The first network error surfaces
      // and the composer shows its Retry control; the player decides.
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

      const request = fetchWithAuth('/v1/llm/generate', { method: 'POST' });
      await expect(request).rejects.toThrow('Failed to fetch');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not let an explicit retryBudgetMs retry a keyless POST (#1787)', async () => {
    vi.useFakeTimers();
    try {
      // The gate overrides the budget: image generation has no server-side
      // dedup either, so a 5 s budget must not buy a second charged call.
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

      const request = fetchWithAuth('/v1/images/generate', {
        method: 'POST',
        retryBudgetMs: 5_000,
      });
      await expect(request).rejects.toThrow('Failed to fetch');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries a keyed POST with the same idempotency key (#1787)', async () => {
    vi.useFakeTimers();
    try {
      // The combat intent mints one x-request-id per submission (#51) and
      // the server replays the stored 2xx for a resent id — so the retry
      // is safe, and it must carry the SAME key or the server cannot dedup.
      fetchMock
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce(response(200, { accepted: true }));

      const request = fetchWithAuth('/v1/combat/enc-1/intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-request-id': 'key-1' },
        body: JSON.stringify({ intent: { type: 'attack', actorId: 'pc-1' } }),
      });
      await vi.advanceTimersByTimeAsync(1_000);

      await expect(request).resolves.toMatchObject({ status: 200 });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ 'x-request-id': 'key-1' });
      expect(fetchMock.mock.calls[1][1].headers).toMatchObject({ 'x-request-id': 'key-1' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries a read-only combat proposal without a key (#1787, #1786)', async () => {
    vi.useFakeTimers();
    try {
      // The propose call POSTs phase: 'propose' to the intent route and
      // the server returns it before the dedup lookup (intents.ts), so no
      // key is honoured there — but the retry is safe anyway, because a
      // proposal resolves nothing (one known exception: a non-off-hand
      // melee proposal can move the actor and append a DM tactical fact,
      // #1802). The body below is the exact shape
      // proposeAuthoritativeAttack sends.
      fetchMock
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce(
          response(200, { accepted: true, proposal: { movementOnly: false } }),
        );

      const request = fetchWithAuth('/v1/combat/enc-1/intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: { type: 'attack', actorId: 'pc-1', targetId: 'npc-1' },
          source: 'dm',
          phase: 'propose',
        }),
      });
      await vi.advanceTimersByTimeAsync(1_000);

      await expect(request).resolves.toMatchObject({ status: 200 });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('x-request-id');
      expect(fetchMock.mock.calls[1][1].headers).not.toHaveProperty('x-request-id');
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries a read-only spell proposal without a key (#1787)', async () => {
    vi.useFakeTimers();
    try {
      // Same allowlist, spell-shaped body — the exact shape
      // proposeAuthoritativeSpell sends. The spell path is genuinely
      // read-only server-side (no approach call), so the retry is safe.
      fetchMock
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce(
          response(200, { accepted: true, proposal: { movementOnly: false } }),
        );

      const request = fetchWithAuth('/v1/combat/enc-1/intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: { type: 'spell', actorId: 'pc-1', targetIds: ['npc-1'], spellName: 'Fireball' },
          source: 'dm',
          phase: 'propose',
        }),
      });
      await vi.advanceTimersByTimeAsync(1_000);

      await expect(request).resolves.toMatchObject({ status: 200 });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('x-request-id');
      expect(fetchMock.mock.calls[1][1].headers).not.toHaveProperty('x-request-id');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry a keyless combat commit — only proposals are allowlisted (#1787)', async () => {
    vi.useFakeTimers();
    try {
      // Same route, no phase field: this is the exact body
      // executeAuthoritativeCombatIntent sends (combat-action-executor.ts).
      // A commit executes, so without a key it must fail fast — the
      // propose allowlist must not open the commit path.
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

      const request = fetchWithAuth('/v1/combat/enc-1/intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: { type: 'attack', actorId: 'pc-1', targetId: 'npc-1' },
          source: 'dm',
        }),
      });
      await expect(request).rejects.toThrow('Failed to fetch');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry an intent POST whose body is not JSON — the allowlist fails closed (#1787)', async () => {
    vi.useFakeTimers();
    try {
      // The propose check parses the body; a body it cannot parse is
      // not a proposal, so the gate must not authorize a retry.
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

      const request = fetchWithAuth('/v1/combat/enc-1/intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      });
      await expect(request).rejects.toThrow('Failed to fetch');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries the turn POST without a key — the server replays it (#1787, #1786)', async () => {
    vi.useFakeTimers();
    try {
      // The turn POST is the one keyless exception: #1786 replays a
      // retried save from the stored rows + cached DM response, keyed by
      // the stored message/reply id. This pins that exception so a future
      // tightening of the gate does not silently stop turn retries.
      fetchMock
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce(response(200, { ok: true }));

      const request = fetchWithAuth('/v1/sessions/session-1/messages', { method: 'POST' });
      await vi.advanceTimersByTimeAsync(1_000);

      await expect(request).resolves.toMatchObject({ status: 200 });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries a keyed POST when the key arrives as a Headers instance (#1787)', async () => {
    vi.useFakeTimers();
    try {
      // The gate normalizes headers before checking them: a Headers
      // instance would spread to {} on the wire, so without normalization
      // the gate would authorize a retry whose key never reaches the
      // server. Both attempts must carry the same key on the wire.
      fetchMock
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce(response(200, { accepted: true }));

      const request = fetchWithAuth('/v1/combat/enc-1/intent', {
        method: 'POST',
        headers: new Headers({ 'Content-Type': 'application/json', 'x-request-id': 'key-2' }),
        body: JSON.stringify({ intent: { type: 'attack', actorId: 'pc-1' } }),
      });
      await vi.advanceTimersByTimeAsync(1_000);

      await expect(request).resolves.toMatchObject({ status: 200 });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ 'x-request-id': 'key-2' });
      expect(fetchMock.mock.calls[1][1].headers).toMatchObject({ 'x-request-id': 'key-2' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries the turn POST with a query string (#1787)', async () => {
    vi.useFakeTimers();
    try {
      // The turn-route match strips the query first, so a query string
      // does not drop the route out of the server-deduped exception.
      fetchMock
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce(response(200, { ok: true }));

      const request = fetchWithAuth('/v1/sessions/session-1/messages?foo=bar', {
        method: 'POST',
      });
      await vi.advanceTimersByTimeAsync(1_000);

      await expect(request).resolves.toMatchObject({ status: 200 });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry a POST nested under the turn route (#1787)', async () => {
    vi.useFakeTimers();
    try {
      // Only the exact turn POST is server-deduped. A deeper path under
      // /messages is a different route with no replay, so it fails fast.
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

      const request = fetchWithAuth('/v1/sessions/session-1/messages/msg-1', { method: 'POST' });
      await expect(request).rejects.toThrow('Failed to fetch');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not treat an empty idempotency key as a key (#1787)', async () => {
    vi.useFakeTimers();
    try {
      // Presence alone is not enough: an empty value cannot dedup
      // server-side, so it must not authorize a retry.
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

      const request = fetchWithAuth('/v1/combat/enc-1/intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-request-id': '' },
        body: JSON.stringify({ intent: { type: 'attack', actorId: 'pc-1' } }),
      });
      await expect(request).rejects.toThrow('Failed to fetch');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not treat a whitespace-only idempotency key as a key (#1787)', async () => {
    vi.useFakeTimers();
    try {
      // Same as an empty key: the server trims the header and treats a
      // whitespace-only value as no key, so it must not authorize a retry.
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

      const request = fetchWithAuth('/v1/combat/enc-1/intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-request-id': '   ' },
        body: JSON.stringify({ intent: { type: 'attack', actorId: 'pc-1' } }),
      });
      await expect(request).rejects.toThrow('Failed to fetch');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
