/**
 * No-overwrite rule (#1249): a tab must never overwrite a stored pair that
 * has a refresh token with one that has none. Repro for the 2026-10-31
 * recurrence: a fresh tab's loadCachedSession() returns access-only (its
 * sessionStorage is empty and it never consults the shared session JSON),
 * and the AuthContext persistence effect then persists that access-only
 * pair — destroying the shared refresh token for every tab, which the
 * storage-event adopt path then spreads into each open tab's state.
 * Token values below are obviously fake; tests check presence only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  loadCachedSession,
  persistSession,
  SESSION_STORAGE_KEY,
  shouldAdoptSharedSession,
} from '../TokenService';

vi.mock('@/lib/logger', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const ACCESS = 'test-access-token';
const REFRESH = 'test-refresh-token';
const ROTATED_ACCESS = 'test-access-token-rotated';
const ROTATED_REFRESH = 'test-refresh-token-rotated';

const fullPair = { access_token: ACCESS, refresh_token: REFRESH };

const sharedJson = (): Record<string, unknown> | null => {
  const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
};

describe('TokenService no-overwrite rule (#1249)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('persistSession never overwrites a stored pair that has a refresh token with one that has none', () => {
    persistSession(fullPair);
    // Fresh-tab access-only read: same access token, no refresh token.
    persistSession({ access_token: ACCESS });

    expect(sharedJson()?.refresh_token).toBe(REFRESH);
    expect(loadCachedSession()?.refresh_token).toBe(REFRESH);
    expect(loadCachedSession()?.access_token).toBe(ACCESS);
  });

  it('persistSession heals the calling tab sessionStorage with the preserved refresh token', () => {
    persistSession(fullPair);
    // Fresh tab: empty sessionStorage, then its mount effect persists the
    // access-only pair it read. The merge must write the preserved refresh
    // token into this tab's sessionStorage, so that even with the shared
    // JSON gone the tab still reads a full pair.
    window.sessionStorage.clear();
    persistSession({ access_token: ACCESS });
    window.localStorage.removeItem(SESSION_STORAGE_KEY);

    expect(loadCachedSession()?.refresh_token).toBe(REFRESH);
  });

  it('persistSession with a different access token does not resurrect a stale refresh token', () => {
    persistSession(fullPair);
    persistSession({ access_token: 'test-access-token-other' });

    expect(sharedJson()).toEqual({ access_token: 'test-access-token-other' });
  });

  it('persistSession(null) still clears everything', () => {
    persistSession(fullPair);
    persistSession(null);

    expect(loadCachedSession()).toBeNull();
    expect(sharedJson()).toBeNull();
    expect(window.sessionStorage.length).toBe(0);
  });

  it('a fresh tab recovers the refresh token from the shared session', () => {
    persistSession(fullPair);
    // New tab: empty sessionStorage, same shared localStorage.
    window.sessionStorage.clear();

    const loaded = loadCachedSession();
    expect(loaded?.access_token).toBe(ACCESS);
    expect(loaded?.refresh_token).toBe(REFRESH);
  });

  it('a second tab mount + persist keeps the shared refresh token', () => {
    persistSession(fullPair);
    // Second tab opens: empty sessionStorage, then its mount effect persists
    // whatever it loaded — the exact step that dropped the token on 10-31.
    window.sessionStorage.clear();
    const loaded = loadCachedSession();
    if (!loaded) throw new Error('expected a session');
    persistSession(loaded);

    expect(sharedJson()?.refresh_token).toBe(REFRESH);
    expect(loadCachedSession()?.refresh_token).toBe(REFRESH);
  });

  it('shouldAdoptSharedSession refuses an access-only session over a pair that has a refresh token', () => {
    expect(shouldAdoptSharedSession(fullPair, { access_token: ACCESS })).toBe(false);
    expect(
      shouldAdoptSharedSession(fullPair, {
        access_token: ROTATED_ACCESS,
        refresh_token: ROTATED_REFRESH,
      }),
    ).toBe(true);
    expect(shouldAdoptSharedSession(null, { access_token: ACCESS })).toBe(true);
    expect(shouldAdoptSharedSession({ access_token: ACCESS }, { access_token: ACCESS })).toBe(true);
    expect(shouldAdoptSharedSession(fullPair, { access_token: '' })).toBe(false);
  });

  it('shouldAdoptSharedSession adopts a different-access access-only session (a new sign-in)', () => {
    // A re-sign-in may legitimately carry no refresh token (CallbackPage and
    // finishSignIn persist refresh only when present). Refusing it would
    // strand this tab on the old session while its refresh timer keeps
    // rotating the old pair over the new sign-in; adoption re-arms the
    // timer via the session?.access_token effect dependency.
    expect(shouldAdoptSharedSession(fullPair, { access_token: ROTATED_ACCESS })).toBe(true);
  });

  it('loadCachedSession prefers the shared JSON refresh token over a stale per-tab one', () => {
    persistSession(fullPair);
    persistSession({ access_token: ROTATED_ACCESS, refresh_token: ROTATED_REFRESH });
    // Simulate a tab that missed the rotation event: its sessionStorage
    // still holds the previous pair's refresh token.
    window.sessionStorage.setItem('workos_refresh_token', REFRESH);
    const loaded = loadCachedSession();
    expect(loaded?.access_token).toBe(ROTATED_ACCESS);
    expect(loaded?.refresh_token).toBe(ROTATED_REFRESH);
    // Persisting what it loaded must not poison the shared pair.
    if (!loaded) throw new Error('expected a session');
    persistSession(loaded);
    expect(sharedJson()?.refresh_token).toBe(ROTATED_REFRESH);
  });
});
