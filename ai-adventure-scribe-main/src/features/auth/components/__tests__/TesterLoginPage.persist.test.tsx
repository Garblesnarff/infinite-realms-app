/**
 * Tester sign-in round trip through the REAL persistSession (#1249): the
 * page must persist both tokens, and a second tab's load+persist round-trip
 * through the real TokenService functions must keep them. Unlike
 * TesterLoginPage.test.tsx (which mocks TokenService), this file asserts
 * real storage so a drop between the server response and storage is caught.
 * Scope, stated plainly: the second-tab step exercises the real
 * loadCachedSession/persistSession functions the AuthContext mount effect
 * calls — it does NOT mount AuthProvider (which would need mocks for its
 * five module dependencies), so the handler's wiring to
 * shouldAdoptSharedSession is covered by diff-read plus the helper unit
 * tests, not by a provider render here. Likewise the 60 s timer advance is
 * a page-level no-delayed-overwrite smoke step, not a scheduler proof —
 * the scheduled refresh lives in AuthProvider, which is not mounted here.
 * Token values are the shared wire fixture's placeholders, never real.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PASSWORD_LOGIN_200_BODY,
  PASSWORD_LOGIN_REQUEST_BODY,
} from '../../../../../shared/test-fixtures/password-login-wire-body';
import TesterLoginPage from '../TesterLoginPage';

import {
  loadCachedSession,
  persistSession,
  SESSION_STORAGE_KEY,
} from '@/services/auth/TokenService';

vi.mock('sonner', () => ({
  toast: { success: vi.fn() },
}));

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const LocationProbe = (): React.ReactElement => {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
};

function renderPage() {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={['/auth/tester']}>
        <TesterLoginPage />
        <LocationProbe />
      </MemoryRouter>
    </HelmetProvider>,
  );
}

async function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: PASSWORD_LOGIN_REQUEST_BODY.email },
  });
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: PASSWORD_LOGIN_REQUEST_BODY.password },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

const sharedJson = (): Record<string, unknown> | null => {
  const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
};

describe('TesterLoginPage real persist round trip (#1249)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.stubEnv('VITE_TESTER_LOGIN', 'true');
    vi.stubEnv('VITE_API_URL', 'https://api.example.test');
    fetchMock = vi.fn();
    global.fetch = Object.assign(fetchMock, { preconnect: vi.fn() });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('persists both tokens, keeps them across 60 s of page timers, and a second-tab load+persist round-trip keeps them', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ...PASSWORD_LOGIN_200_BODY }),
    });

    renderPage();
    await fillAndSubmit();

    // Right after finishSignIn: both tokens in real storage.
    await waitFor(() => {
      expect(sharedJson()?.refresh_token).toBe(PASSWORD_LOGIN_200_BODY.refreshToken);
    });
    expect(sharedJson()?.access_token).toBe(PASSWORD_LOGIN_200_BODY.accessToken);
    expect(window.sessionStorage.getItem('workos_refresh_token')).toBe(
      PASSWORD_LOGIN_200_BODY.refreshToken,
    );

    // Let the page navigate via auth-ready, as the real flow does.
    window.dispatchEvent(
      new CustomEvent('auth-ready', {
        detail: { user: { email: PASSWORD_LOGIN_REQUEST_BODY.email } },
      }),
    );
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/app'));

    // 60 s of page timers: the page schedules no delayed overwrite, so the
    // refresh token must still be there. (Not a scheduler proof: no
    // AuthProvider is mounted here; see the file header.)
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sharedJson()?.refresh_token).toBe(PASSWORD_LOGIN_200_BODY.refreshToken);
    vi.useRealTimers();

    // Second tab opens on a game page: fresh sessionStorage, shared localStorage.
    window.sessionStorage.clear();
    const secondTab = loadCachedSession();
    expect(secondTab?.refresh_token).toBe(PASSWORD_LOGIN_200_BODY.refreshToken);
    // Its mount effect persists whatever it loaded — the step that dropped
    // the token on 10-31 must not destroy the shared pair. This exercises
    // the real functions the effect calls, not a mounted effect itself.
    if (!secondTab) throw new Error('expected a session');
    persistSession(secondTab);
    expect(sharedJson()?.refresh_token).toBe(PASSWORD_LOGIN_200_BODY.refreshToken);
  });
});
