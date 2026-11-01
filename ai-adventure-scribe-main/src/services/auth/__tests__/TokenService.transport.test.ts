import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  clearSessionEnded,
  getLastRefreshCompletedAt,
  isSessionEnded,
  loadCachedSession,
  markSessionEnded,
  persistSession,
  refreshAccessTokenOnce,
  resetLastRefreshCompletedAtForTests,
  TokenRefreshTransientError,
  TokenRefreshTransportError,
} from '../TokenService';

vi.mock('@/lib/logger', () => ({
  default: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

describe('TokenService transport failures (#565)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    const storageMock = () => {
      let store: Record<string, string> = {};
      return {
        getItem: vi.fn((key: string) => store[key] || null),
        setItem: vi.fn((key: string, value: string) => {
          store[key] = value.toString();
        }),
        removeItem: vi.fn((key: string) => {
          delete store[key];
        }),
        clear: vi.fn(() => {
          store = {};
        }),
      };
    };

    vi.stubGlobal('localStorage', storageMock());
    vi.stubGlobal('sessionStorage', storageMock());
    vi.stubGlobal('fetch', vi.fn());
    clearSessionEnded();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('rejects with TokenRefreshTransportError when the endpoint hangs past the timeout', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {})); // blackhole

    const attempt = refreshAccessTokenOnce('old-refresh');
    const assertion = expect(attempt).rejects.toBeInstanceOf(TokenRefreshTransportError);
    await vi.advanceTimersByTimeAsync(15_040);
    await assertion;

    // Not an auth verdict: the session is not ended and nothing was wiped.
    expect(isSessionEnded()).toBe(false);
  });

  it('rejects with TokenRefreshTransportError on a network failure', async () => {
    persistSession({ access_token: 'old-access', refresh_token: 'old-refresh' });
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new TypeError('Failed to fetch'),
    );

    const attempt = refreshAccessTokenOnce('old-refresh');
    const assertion = expect(attempt).rejects.toBeInstanceOf(TokenRefreshTransportError);
    await vi.advanceTimersByTimeAsync(40);
    await assertion;
    // Not an auth verdict: the session is not ended and the stored pair is intact.
    expect(isSessionEnded()).toBe(false);
    expect(loadCachedSession()).toMatchObject({ access_token: 'old-access' });
  });

  it('keeps a 502 refresh transient instead of ending the session', async () => {
    persistSession({ access_token: 'old-access', refresh_token: 'old-refresh' });
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ error: 'upstream unavailable' }), { status: 502 }),
    );

    const attempt = refreshAccessTokenOnce('old-refresh');
    const assertion = expect(attempt).rejects.toBeInstanceOf(TokenRefreshTransientError);
    await vi.advanceTimersByTimeAsync(40);
    await assertion;
    expect(isSessionEnded()).toBe(false);
    expect(loadCachedSession()).toMatchObject({ access_token: 'old-access' });
  });

  it('still resolves null for a non-transport failure', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));

    const attempt = refreshAccessTokenOnce('old-refresh');
    await vi.advanceTimersByTimeAsync(40);
    await expect(attempt).resolves.toBeNull();
  });

  describe('refresh completion record (#1113)', () => {
    beforeEach(() => {
      resetLastRefreshCompletedAtForTests();
    });

    it('records when a refresh yields a token pair', async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ accessToken: 'new-access', refreshToken: 'new-refresh' }),
      });
      vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));

      const attempt = refreshAccessTokenOnce('old-refresh');
      await vi.advanceTimersByTimeAsync(40);
      await expect(attempt).resolves.toMatchObject({ accessToken: 'new-access' });

      expect(getLastRefreshCompletedAt()).toBe(Date.parse('2026-11-01T12:00:00Z') + 40);
    });

    it('does not record a refresh that resolves null', async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));

      const attempt = refreshAccessTokenOnce('old-refresh');
      await vi.advanceTimersByTimeAsync(40);
      await expect(attempt).resolves.toBeNull();

      expect(getLastRefreshCompletedAt()).toBeNull();
    });

    it('clears the completion record when the session ends', async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ accessToken: 'new-access', refreshToken: 'new-refresh' }),
      });
      const attempt = refreshAccessTokenOnce('old-refresh');
      await vi.advanceTimersByTimeAsync(40);
      await attempt;
      expect(getLastRefreshCompletedAt()).not.toBeNull();

      markSessionEnded(new Error('signed out'));

      expect(getLastRefreshCompletedAt()).toBeNull();
    });
  });
});
