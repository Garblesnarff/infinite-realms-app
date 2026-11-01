import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CallbackPage from '../CallbackPage';

const { navigate, persistSession, toastSuccess } = vi.hoisted(() => ({
  navigate: vi.fn(),
  persistSession: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: toastSuccess },
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
}));

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/services/auth/TokenService', async (importOriginal) =>
  (await import('@/test/token-service-mock')).createTokenServiceMock(importOriginal, {
    persistSession,
  }),
);

describe('CallbackPage', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/auth/callback');
    fetchMock = vi.fn();
    global.fetch = Object.assign(fetchMock, { preconnect: vi.fn() });
  });

  it('exchanges a callback code and preserves the existing auth handoff', async () => {
    window.history.replaceState(null, '', '/auth/callback?code=one-time-code');
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ accessToken: 'test-access-token', refreshToken: 'test-refresh-token' }),
    });

    render(<CallbackPage />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/v1/auth/exchange'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'one-time-code' }),
        signal: expect.any(AbortSignal), // 15 s exchange ceiling (#565)
      });
    });
    expect(persistSession).toHaveBeenCalledWith({
      access_token: expect.any(String),
      refresh_token: expect.any(String),
    });
    expect(window.location.search).toBe('');

    window.dispatchEvent(new CustomEvent('auth-ready'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/app'));
  });

  it('says which account signed in once auth is ready (#2292)', async () => {
    window.history.replaceState(null, '', '/auth/callback?code=one-time-code');
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ accessToken: 'test-access-token', refreshToken: 'test-refresh-token' }),
    });

    render(<CallbackPage />);
    await waitFor(() => expect(persistSession).toHaveBeenCalled());

    window.dispatchEvent(
      new CustomEvent('auth-ready', { detail: { user: { email: 'player@example.com' } } }),
    );
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/app'));
    expect(toastSuccess).toHaveBeenCalledWith('Signed in as player@example.com');
  });

  it('returns to a validated campaign path after the exchange', async () => {
    window.history.replaceState(
      null,
      '',
      '/auth/callback?code=one-time-code&returnTo=%2Fexplore%2Fthe-eternal-feast%23heroes',
    );
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ accessToken: 'test-access-token', refreshToken: 'test-refresh-token' }),
    });

    render(<CallbackPage />);
    await waitFor(() => expect(persistSession).toHaveBeenCalled());
    window.dispatchEvent(new CustomEvent('auth-ready'));

    // #1122: the return carries `authReturn`, the only signal that resumes a pending hero.
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/explore/the-eternal-feast#heroes', {
        state: { authReturn: true },
      }),
    );
  });

  it('falls back to the app when the return path is off-site', async () => {
    window.history.replaceState(
      null,
      '',
      '/auth/callback?code=one-time-code&returnTo=https%3A%2F%2Fevil.example%2Fsteal',
    );
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ accessToken: 'test-access-token', refreshToken: 'test-refresh-token' }),
    });

    render(<CallbackPage />);
    await waitFor(() => expect(persistSession).toHaveBeenCalled());
    window.dispatchEvent(new CustomEvent('auth-ready'));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/app'));
  });

  it('uses the deprecated fragment fallback only when no code is present', async () => {
    window.history.replaceState(
      null,
      '',
      '/auth/callback#access_token=legacy-access&refresh_token=legacy-refresh',
    );

    render(<CallbackPage />);

    await waitFor(() => expect(persistSession).toHaveBeenCalledTimes(1));
    expect(global.fetch).not.toHaveBeenCalled();
    expect(persistSession).toHaveBeenCalledWith({
      access_token: expect.any(String),
      refresh_token: expect.any(String),
    });
  });

  it('passes an abort signal to the exchange fetch (#565)', async () => {
    window.history.replaceState(null, '', '/auth/callback?code=one-time-code');
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ accessToken: 'test-access-token', refreshToken: 'test-refresh-token' }),
    });

    render(<CallbackPage />);

    await waitFor(() => {
      const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    });
  });

  it('shows an error instead of hanging when the exchange stalls (#565)', async () => {
    vi.useFakeTimers();
    window.history.replaceState(null, '', '/auth/callback?code=one-time-code');
    fetchMock.mockReturnValue(new Promise(() => {})); // blackhole

    render(<CallbackPage />);

    // "Completing sign in..." is showing; the 15 s exchange ceiling fires,
    // then the existing error path redirects home after 3 s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
      await vi.advanceTimersByTimeAsync(3_000);
    });
    vi.useRealTimers();
    await screen.findByText('Authentication Error');
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('shows a wait message when the exchange returns the rate-limit body (#753)', async () => {
    // The body createSimpleRateLimit returns: server-bun/src/middleware/rate-limit.ts:472-485.
    window.history.replaceState(null, '', '/auth/callback?code=one-time-code');
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({
        error: {
          name: 'RateLimitError',
          message: 'Too many requests, please try again later',
          code: 'RATE_LIMIT_EXCEEDED',
          statusCode: 429,
          details: { scope: 'ip', limit: 10, window: 60, retryAfter: 30 },
        },
      }),
    });

    render(<CallbackPage />);

    expect(
      await screen.findByText('Too many sign-ins at once. Wait a minute, then try again.'),
    ).toBeTruthy();
    expect(screen.queryByText('An error occurred during authentication')).toBeNull();
    expect(screen.queryByText('Authentication failed - no access token received')).toBeNull();
    expect(screen.queryByText('Redirecting...')).toBeNull();
    await act(async () => {
      screen.getByRole('button', { name: 'Try again' }).click();
    });
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('keeps the generic message when the exchange fails for another reason', async () => {
    vi.useFakeTimers();
    window.history.replaceState(null, '', '/auth/callback?code=one-time-code');
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'invalid_code' }),
    });

    render(<CallbackPage />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    vi.useRealTimers();
    expect(screen.getByText('An error occurred during authentication')).toBeTruthy();
    expect(screen.getByText('Redirecting...')).toBeTruthy();
    expect(
      screen.queryByText('Too many sign-ins at once. Wait a minute, then try again.'),
    ).toBeNull();
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('keeps the generic message for other callback errors', async () => {
    window.history.replaceState(null, '', '/auth/callback');

    render(<CallbackPage />);

    expect(
      await screen.findByText('Authentication failed - no access token received'),
    ).toBeTruthy();
    expect(screen.getByText('Redirecting...')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});
