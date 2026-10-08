/**
 * Characterization of where token material lives in browser storage today.
 *
 * Tracks #2673 step 2a. These tests document current behavior, including the
 * weakness the issue describes; they do not assert that the behavior is right.
 * Step 2b changes storage and will flip the assertions. Values are obviously
 * fake and are never printed: the tests check key names and whether the stored
 * session JSON has a refresh_token field.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { persistSession, refreshAccessToken, SESSION_STORAGE_KEY } from '../TokenService';

import logger from '@/lib/logger';

vi.mock('@/lib/logger', () => ({
  default: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

const FAKE_ACCESS_TOKEN = 'test-access-token';
const FAKE_REFRESH_TOKEN = 'test-refresh-token';

// Same shape CallbackPage.tsx passes to persistSession after the code exchange.
const signInSession = {
  access_token: FAKE_ACCESS_TOKEN,
  refresh_token: FAKE_REFRESH_TOKEN,
};

const storageKeys = (storage: Storage): string[] =>
  Array.from({ length: storage.length }, (_, index) => storage.key(index) ?? '').sort();

const cachedSessionHasRefreshField = (): boolean => {
  const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) return false;
  return 'refresh_token' in (JSON.parse(raw) as Record<string, unknown>);
};

describe('TokenService token storage (#2673 step 2a characterization)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('documents #2673 P1: sign-in writes the refresh token into the localStorage session cache', () => {
    persistSession(signInSession);

    expect(storageKeys(window.localStorage)).toEqual([
      'aas_workos_cached_session',
      'workos_access_token',
    ]);
    expect(cachedSessionHasRefreshField()).toBe(true);
  });

  it('documents #2673 P1: sign-in also keeps the refresh token in sessionStorage, not localStorage', () => {
    persistSession(signInSession);

    expect(storageKeys(window.sessionStorage)).toEqual(['workos_refresh_token']);
    expect(window.localStorage.getItem('workos_refresh_token')).toBeNull();
  });

  it('documents #2673 P1: a token refresh rewrites the refresh token into the localStorage session cache', async () => {
    persistSession(signInSession);
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        accessToken: 'test-access-token-rotated',
        refreshToken: 'test-refresh-token-rotated',
      }),
    } as Response);

    const refreshed = await refreshAccessToken(FAKE_REFRESH_TOKEN, FAKE_ACCESS_TOKEN);

    expect(refreshed).not.toBeNull();
    expect(storageKeys(window.localStorage)).toEqual([
      'aas_workos_cached_session',
      'workos_access_token',
    ]);
    expect(cachedSessionHasRefreshField()).toBe(true);
    expect(vi.mocked(logger.error)).not.toHaveBeenCalled();
  });
});
