import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider, useAuth } from '../AuthContext';

import { clearSessionEnded, persistSession } from '@/services/auth/TokenService';

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
  const { loading, connectionError, session } = useAuth();
  return (
    <div data-testid="probe">
      {JSON.stringify({
        loading,
        connectionError,
        accessToken: session?.access_token ?? null,
      })}
    </div>
  );
}

function probeState(): {
  loading: boolean;
  connectionError: boolean;
  accessToken: string | null;
} {
  return JSON.parse(screen.getByTestId('probe').textContent || '{}');
}

const authMe = (status: number): Response =>
  new Response(JSON.stringify({}), { status, headers: { 'Content-Type': 'application/json' } });

describe('AuthContext transient failure stale pair (#1302)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authTelemetryMocks.reportClientFailure.mockClear();
    clearSessionEnded();
    window.localStorage.clear();
    window.sessionStorage.clear();
    persistSession({ access_token: 'pair-a-access', refresh_token: 'pair-a-refresh' });
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('does not write back a stale pair when another tab rotated tokens during a 5xx', async () => {
    let resolveAuthMe!: (response: Response) => void;
    const pendingAuthMe = new Promise<Response>((resolve) => {
      resolveAuthMe = resolve;
    });
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/api/trpc/auth.me')) return pendingAuthMe;
      return Promise.resolve(authMe(404));
    });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/trpc/auth.me'))).toBe(
        true,
      ),
    );

    // Another tab rotates the pair while this tab's auth.me is in flight.
    act(() => {
      persistSession({ access_token: 'pair-b-access', refresh_token: 'pair-b-refresh' });
    });

    await act(async () => {
      resolveAuthMe(authMe(500));
      await pendingAuthMe;
    });

    await waitFor(() => expect(probeState().loading).toBe(false));
    expect(probeState().connectionError).toBe(true);
    expect(window.localStorage.getItem('workos_access_token')).toBe('pair-b-access');
    expect(probeState().accessToken).toBe('pair-b-access');
  });
});
