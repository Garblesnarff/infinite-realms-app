import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider, useAuth } from '../AuthContext';

import {
  clearSessionEnded,
  persistSession,
  SESSION_STORAGE_KEY,
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
  const { loading, connectionError, session, sessionEnded, user } = useAuth();
  return (
    <div data-testid="probe">
      {JSON.stringify({
        loading,
        connectionError,
        sessionEnded,
        accessToken: session?.access_token ?? null,
        userEmail: user?.email ?? null,
      })}
    </div>
  );
}

function probeState(): {
  loading: boolean;
  connectionError: boolean;
  sessionEnded: boolean;
  accessToken: string | null;
  userEmail: string | null;
} {
  return JSON.parse(screen.getByTestId('probe').textContent || '{}');
}

const authMeOk = (email: string): Response =>
  new Response(
    JSON.stringify({
      result: { data: { id: 'user-1', email, firstName: 'A', lastName: 'B' } },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

/** Dispatch what another tab's storage write delivers to this tab. Falls back
 *  to a plain Event with the StorageEvent fields when jsdom lacks the
 *  StorageEvent constructor; the handler only reads key/newValue. */
function dispatchStorageEvent(
  key: string | null,
  newValue: string | null,
  oldValue: string | null,
): void {
  let event: StorageEvent;
  try {
    event = new StorageEvent('storage', {
      key,
      newValue,
      oldValue,
      storageArea: window.localStorage,
    });
  } catch {
    event = new window.Event('storage') as StorageEvent;
    Object.defineProperties(event, {
      key: { value: key },
      newValue: { value: newValue },
      oldValue: { value: oldValue },
    });
  }
  act(() => {
    window.dispatchEvent(event);
  });
}

const pairA = { access_token: 'pair-a-access', refresh_token: 'pair-a-refresh' };
const pairB = { access_token: 'pair-b-access', refresh_token: 'pair-b-refresh' };

describe('AuthContext sign-out propagation across tabs (#1302 item 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authTelemetryMocks.reportClientFailure.mockClear();
    clearSessionEnded();
    window.localStorage.clear();
    window.sessionStorage.clear();
    persistSession(pairA);
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function mountSettled(): Promise<ReturnType<typeof vi.fn>> {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/api/trpc/auth.me')) {
        return Promise.resolve(authMeOk('a@example.com'));
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 404 }));
    });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(probeState().loading).toBe(false));
    expect(probeState().accessToken).toBe('pair-a-access');
    expect(probeState().userEmail).toBe('a@example.com');
    return fetchMock;
  }

  function authMeCallCount(fetchMock: ReturnType<typeof vi.fn>): number {
    return fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/trpc/auth.me')).length;
  }

  it('clears the session in this tab when another tab signs out (session key removed)', async () => {
    const fetchMock = await mountSettled();
    const callsBefore = authMeCallCount(fetchMock);

    // Tab A signs out: its persistSession(null) removes the shared key, and
    // this tab receives the removal event (newValue null).
    act(() => {
      persistSession(null);
    });
    // In a real second tab, tab A's sign-out cannot clear this tab's
    // per-tab sessionStorage: re-seed it, so the assertion below proves
    // this tab's own cleanup removes it rather than the simulation.
    window.sessionStorage.setItem('workos_refresh_token', 'pair-a-refresh');
    dispatchStorageEvent(SESSION_STORAGE_KEY, null, JSON.stringify(pairA));
    await act(async () => {});

    expect(probeState().accessToken).toBe(null);
    expect(probeState().userEmail).toBe(null);
    // Local sign-out does not set the terminal session-ended flag.
    expect(probeState().sessionEnded).toBe(false);
    // Nothing wrote the session back: the key stays gone, and the handler
    // did not trigger a re-verification (no re-login loop).
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBe(null);
    expect(window.localStorage.getItem('workos_access_token')).toBe(null);
    expect(window.sessionStorage.getItem('workos_refresh_token')).toBe(null);
    expect(authMeCallCount(fetchMock)).toBe(callsBefore);
  });

  it('still adopts a new pair published by another tab', async () => {
    await mountSettled();

    dispatchStorageEvent(SESSION_STORAGE_KEY, JSON.stringify(pairB), JSON.stringify(pairA));

    await waitFor(() => expect(probeState().accessToken).toBe('pair-b-access'));
    expect(probeState().userEmail).toBe('a@example.com');
  });
});
