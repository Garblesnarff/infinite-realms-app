import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider, useAuth } from '../AuthContext';

import {
  clearSessionEnded,
  getTokenExpiry,
  isSessionEnded,
  persistSession,
} from '@/services/auth/TokenService';

const authTelemetryMocks = vi.hoisted(() => ({ reportClientFailure: vi.fn() }));

vi.mock('@/lib/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: authTelemetryMocks,
}));

vi.mock('@/hooks/auth/use-blog-role', () => ({
  useBlogRole: () => ({
    blogRole: null,
    blogRoleLoading: false,
    isBlogAdmin: false,
    refreshBlogRole: vi.fn(),
  }),
}));

vi.mock('@/hooks/auth/use-user-plan', () => ({
  useUserPlan: () => ({
    userPlan: null,
    userPlanLoading: false,
    userPlanError: false,
    refreshUserPlan: vi.fn(),
  }),
}));

function Probe() {
  const { loading, connectionError, user } = useAuth();
  return (
    <div data-testid="probe">
      {JSON.stringify({
        loading,
        connectionError,
        userEmail: user?.email ?? null,
      })}
    </div>
  );
}

function probeState(): { loading: boolean; connectionError: boolean; userEmail: string | null } {
  return JSON.parse(screen.getByTestId('probe').textContent || '{}');
}

const authMe = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const tokenWithExpiry = (secondsFromNow: number): string =>
  `header.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + secondsFromNow }))}.signature`;

describe('AuthContext connection failures (#565)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authTelemetryMocks.reportClientFailure.mockClear();
    clearSessionEnded();
    window.localStorage.clear();
    window.sessionStorage.clear();
    persistSession({ access_token: 'old-access', refresh_token: 'old-refresh' });
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps the stored session and raises connectionError when verification hangs', async () => {
    vi.useFakeTimers();
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {})); // blackhole

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(probeState().loading).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_040);
    });

    const state = probeState();
    expect(state.loading).toBe(false);
    expect(state.connectionError).toBe(true);
    expect(state.userEmail).toBeNull();
    // The stored session is intact — no silent sign-out.
    expect(window.localStorage.getItem('workos_access_token')).toBe('old-access');
  });

  it('does not end a logged-out visitor session or send refresh telemetry', async () => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    clearSessionEnded();

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(isSessionEnded()).toBe(false);
    expect(authTelemetryMocks.reportClientFailure).not.toHaveBeenCalled();
  });

  it('keeps the stored session and raises connectionError on a 5xx', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(authMe(502));

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(probeState().loading).toBe(false));
    const state = probeState();
    expect(state.connectionError).toBe(true);
    expect(window.localStorage.getItem('workos_access_token')).toBe('old-access');
  });

  it('still wipes the session when the token is rejected and refresh fails', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (String(url).includes('/v1/auth/refresh')) {
        return Promise.resolve(authMe(400, { error: 'not_invalid_grant' }));
      }
      return Promise.resolve(authMe(401));
    });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(probeState().loading).toBe(false));
    const state = probeState();
    expect(state.connectionError).toBe(false);
    expect(window.localStorage.getItem('workos_access_token')).toBeNull();
  });

  it('retries auth.me with the refreshed access token after a 401', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    let authMeAttempts = 0;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).includes('/api/trpc/auth.me')) {
        authMeAttempts += 1;
        if (authMeAttempts === 1) return Promise.resolve(authMe(401));
        expect((init?.headers as Record<string, string>).Authorization).toBe(
          'Bearer refreshed-access',
        );
        return Promise.resolve(
          authMe(200, { result: { data: { id: 'u1', email: 'player@example.com' } } }),
        );
      }
      if (String(url).includes('/v1/auth/refresh')) {
        return Promise.resolve(
          authMe(200, { accessToken: 'refreshed-access', refreshToken: 'refreshed-refresh' }),
        );
      }
      return Promise.resolve(authMe(404));
    });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(probeState().userEmail).toBe('player@example.com'));
    expect(authMeAttempts).toBe(2);
    expect(window.localStorage.getItem('workos_access_token')).toBe('refreshed-access');
    expect(window.localStorage.getItem('workos_refresh_token')).toBeNull();
    expect(window.sessionStorage.getItem('workos_refresh_token')).toBe('refreshed-refresh');
  });

  it('keeps the player signed in when a refresh 200 races a winning cross-tab pair', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    let authMeAttempts = 0;
    let secondAuthorization: string | undefined;
    let winningPairPublished = false;
    const originalSetItem = Storage.prototype.setItem;
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      originalSetItem.call(this, key, value);
      if (
        !winningPairPublished &&
        this === window.localStorage &&
        key === 'aas_workos_cached_session' &&
        value.includes('refreshed-access')
      ) {
        winningPairPublished = true;
        originalSetItem.call(window.localStorage, 'workos_access_token', 'winning-access');
        originalSetItem.call(
          window.localStorage,
          'aas_workos_cached_session',
          JSON.stringify({ access_token: 'winning-access', refresh_token: 'winning-refresh' }),
        );
        window.sessionStorage.setItem('workos_refresh_token', 'winning-refresh');
      }
    });

    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).includes('/api/trpc/auth.me')) {
        authMeAttempts += 1;
        if (authMeAttempts === 1) return Promise.resolve(authMe(401));
        secondAuthorization = (init?.headers as Record<string, string>).Authorization;
        if (secondAuthorization !== 'Bearer winning-access') return Promise.resolve(authMe(401));
        return Promise.resolve(
          authMe(200, { result: { data: { id: 'u1', email: 'player@example.com' } } }),
        );
      }
      if (String(url).includes('/v1/auth/refresh')) {
        return Promise.resolve(
          authMe(200, { accessToken: 'refreshed-access', refreshToken: 'refreshed-refresh' }),
        );
      }
      return Promise.resolve(authMe(404));
    });

    try {
      render(
        <AuthProvider>
          <Probe />
        </AuthProvider>,
      );

      await waitFor(() => expect(probeState().userEmail).toBe('player@example.com'));
      expect(authMeAttempts).toBe(2);
      expect(secondAuthorization).toBe('Bearer winning-access');
      expect(winningPairPublished).toBe(true);
      expect(window.localStorage.getItem('workos_access_token')).toBe('winning-access');
      expect(window.sessionStorage.getItem('workos_refresh_token')).toBe('winning-refresh');
    } finally {
      setItemSpy.mockRestore();
    }
  });

  it('adopts a newer cross-tab session when the refresh token is rejected', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    let authMeAttempts = 0;
    let refreshAttempts = 0;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).includes('/api/trpc/auth.me')) {
        authMeAttempts += 1;
        if (authMeAttempts === 1) return Promise.resolve(authMe(401));
        expect((init?.headers as Record<string, string>).Authorization).toBe(
          'Bearer winning-access',
        );
        return Promise.resolve(
          authMe(200, { result: { data: { id: 'u1', email: 'player@example.com' } } }),
        );
      }
      if (String(url).includes('/v1/auth/refresh')) {
        refreshAttempts += 1;
        persistSession({ access_token: 'winning-access', refresh_token: 'winning-refresh' });
        return Promise.resolve(authMe(401, { error: 'invalid_grant' }));
      }
      return Promise.resolve(authMe(404));
    });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(probeState().userEmail).toBe('player@example.com'));
    expect(authMeAttempts).toBe(2);
    expect(refreshAttempts).toBe(1);
    expect(window.localStorage.getItem('workos_access_token')).toBe('winning-access');
    expect(window.sessionStorage.getItem('workos_refresh_token')).toBe('winning-refresh');
  });

  it('keeps the stored session when the refresh endpoint hangs during a 401', async () => {
    vi.useFakeTimers();
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (String(url).includes('/v1/auth/refresh')) {
        return new Promise(() => {}); // blackhole
      }
      return Promise.resolve(authMe(401));
    });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_040);
    });

    const state = probeState();
    expect(state.loading).toBe(false);
    expect(state.connectionError).toBe(true);
    expect(window.localStorage.getItem('workos_access_token')).toBe('old-access');
  });

  it('recovers: a retry after the outage signs the user back in', async () => {
    vi.useFakeTimers();
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockReturnValue(new Promise(() => {})); // blackhole

    let refreshAuth!: () => Promise<void>;
    function Capture() {
      ({ refreshAuth } = useAuth());
      return <Probe />;
    }
    render(
      <AuthProvider>
        <Capture />
      </AuthProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_040);
    });
    expect(probeState().connectionError).toBe(true);

    // The deploy ends: verification now succeeds.
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/api/trpc/auth.me')) {
        return Promise.resolve(
          authMe(200, { result: { data: { id: 'u1', email: 'player@example.com' } } }),
        );
      }
      return Promise.resolve(authMe(404));
    });

    await act(async () => {
      await refreshAuth();
    });

    const state = probeState();
    expect(state.connectionError).toBe(false);
    expect(state.userEmail).toBe('player@example.com');
  });

  it('checks an expiring token again when the window regains focus', async () => {
    const expiringToken = `header.${btoa(
      JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 30 }),
    )}.signature`;
    persistSession({ access_token: expiringToken, refresh_token: 'old-refresh' });
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/api/trpc/auth.me')) {
        return Promise.resolve(
          authMe(200, { result: { data: { id: 'u1', email: 'player@example.com' } } }),
        );
      }
      return Promise.resolve(
        authMe(200, { accessToken: expiringToken, refreshToken: 'old-refresh' }),
      );
    });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(probeState().loading).toBe(false));
    fetchMock.mockClear();

    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/v1/auth/refresh'))).toBe(
        true,
      ),
    );
  });

  it('checks an expiring token again when the document becomes visible', async () => {
    const expiringToken = `header.${btoa(
      JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 90 }),
    )}.signature`;
    persistSession({ access_token: expiringToken, refresh_token: 'old-refresh' });
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/api/trpc/auth.me')) {
        return Promise.resolve(
          authMe(200, { result: { data: { id: 'u1', email: 'player@example.com' } } }),
        );
      }
      return Promise.resolve(
        authMe(200, { accessToken: expiringToken, refreshToken: 'old-refresh' }),
      );
    });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(probeState().loading).toBe(false));
    fetchMock.mockClear();

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/v1/auth/refresh'))).toBe(
        true,
      ),
    );
  });

  it('refreshes from the token deadline without waiting for a focus or visibility event', async () => {
    vi.useFakeTimers();
    const expiringToken = tokenWithExpiry(300);
    persistSession({ access_token: expiringToken, refresh_token: 'old-refresh' });
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    let refreshAttempts = 0;
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/api/trpc/auth.me')) {
        return Promise.resolve(
          authMe(200, { result: { data: { id: 'u1', email: 'player@example.com' } } }),
        );
      }
      if (String(url).includes('/v1/auth/refresh')) {
        refreshAttempts += 1;
        return Promise.resolve(
          authMe(200, { accessToken: 'fresh-access', refreshToken: 'fresh-refresh' }),
        );
      }
      return Promise.resolve(authMe(404));
    });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(probeState().loading).toBe(false);
    fetchMock.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(refreshAttempts).toBe(1);
    const originalExpiry = getTokenExpiry(expiringToken);
    expect(originalExpiry).toEqual(expect.any(Number));
    expect(Date.now()).toBeLessThan(originalExpiry ?? Number.POSITIVE_INFINITY);
  });

  it('refreshes opaque tokens on a fixed cadence and records the no-expiry decision', async () => {
    vi.useFakeTimers();
    persistSession({ access_token: 'opaque-workos-token', refresh_token: 'old-refresh' });
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    let refreshAttempts = 0;
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/api/trpc/auth.me')) {
        return Promise.resolve(
          authMe(200, { result: { data: { id: 'u1', email: 'player@example.com' } } }),
        );
      }
      if (String(url).includes('/v1/auth/refresh')) {
        refreshAttempts += 1;
        return Promise.resolve(
          authMe(200, { accessToken: 'opaque-workos-token', refreshToken: 'old-refresh' }),
        );
      }
      return Promise.resolve(authMe(404));
    });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4 * 60 * 1000 + 100);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(refreshAttempts).toBe(1);
  });

  it('does not refresh an opaque token on a focus event', async () => {
    vi.useFakeTimers();
    persistSession({ access_token: 'opaque-workos-token', refresh_token: 'old-refresh' });
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    let refreshAttempts = 0;
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/api/trpc/auth.me')) {
        return Promise.resolve(
          authMe(200, { result: { data: { id: 'u1', email: 'player@example.com' } } }),
        );
      }
      if (String(url).includes('/v1/auth/refresh')) {
        refreshAttempts += 1;
        return Promise.resolve(
          authMe(200, { accessToken: 'opaque-workos-token', refreshToken: 'old-refresh' }),
        );
      }
      return Promise.resolve(authMe(404));
    });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => window.dispatchEvent(new Event('focus')));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(refreshAttempts).toBe(0);
  });

  it('rate-limits a repeated no-refresh-token diagnostic for ten minutes per tab', async () => {
    vi.useFakeTimers();
    persistSession({ access_token: 'opaque-workos-token' });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      authMe(200, { result: { data: { id: 'u1', email: 'player@example.com' } } }),
    );

    const first = render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    first.unmount();

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      authTelemetryMocks.reportClientFailure.mock.calls.filter(
        ([kind, , , details]) =>
          kind === 'auth_refresh_check_skipped' && details?.message === 'reason=no_refresh_token',
      ),
    ).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1);
    });
    cleanup();
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      authTelemetryMocks.reportClientFailure.mock.calls.filter(
        ([kind, , , details]) =>
          kind === 'auth_refresh_check_skipped' && details?.message === 'reason=no_refresh_token',
      ),
    ).toHaveLength(2);
  });

  it('backs off a transient scheduled refresh and retries while keeping the session', async () => {
    vi.useFakeTimers();
    const expiringToken = tokenWithExpiry(360);
    persistSession({ access_token: expiringToken, refresh_token: 'old-refresh' });
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    let refreshAttempts = 0;
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/api/trpc/auth.me')) {
        return Promise.resolve(
          authMe(200, { result: { data: { id: 'u1', email: 'u1@example.com' } } }),
        );
      }
      if (String(url).includes('/v1/auth/refresh')) {
        refreshAttempts += 1;
        return Promise.resolve(
          refreshAttempts === 1
            ? authMe(502)
            : authMe(200, { accessToken: 'fresh-access', refreshToken: 'fresh-refresh' }),
        );
      }
      return Promise.resolve(authMe(404));
    });
    vi.spyOn(Math, 'random').mockReturnValue(0);

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    fetchMock.mockClear();

    const refreshDelay = getTokenExpiry(expiringToken)! - 2 * 60 * 1000 - Date.now();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(refreshDelay);
      await vi.advanceTimersByTimeAsync(100);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(refreshAttempts).toBe(1);
    expect(window.localStorage.getItem('workos_access_token')).toBe(expiringToken);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_899);
      await Promise.resolve();
    });
    expect(refreshAttempts).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(101);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(refreshAttempts).toBe(2);
    expect(window.localStorage.getItem('workos_access_token')).toBe('fresh-access');
  });
});
