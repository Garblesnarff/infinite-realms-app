import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider, useAuth } from '../AuthContext';

import { persistSession } from '@/services/auth/TokenService';

vi.mock('@/lib/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
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

describe('AuthContext connection failures (#565)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    persistSession({ access_token: 'old-access', refresh_token: 'old-refresh' });
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
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
      await vi.advanceTimersByTimeAsync(15_000);
    });

    const state = probeState();
    expect(state.loading).toBe(false);
    expect(state.connectionError).toBe(true);
    expect(state.userEmail).toBeNull();
    // The stored session is intact — no silent sign-out.
    expect(window.localStorage.getItem('workos_access_token')).toBe('old-access');
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
      await vi.advanceTimersByTimeAsync(15_000);
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
      await vi.advanceTimersByTimeAsync(15_000);
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
});
