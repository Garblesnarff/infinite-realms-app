import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { useBlogRole, type BlogRole } from '@/hooks/auth/use-blog-role';
import { useUserPlan, type UserPlan } from '@/hooks/auth/use-user-plan';
import { fetchWithAuth } from '@/infrastructure/api/rest-client';
import { resetAuthGate, markAuthReady } from '@/lib/auth-gate';
import logger from '@/lib/logger';
import {
  clearSessionEnded,
  getTokenExpiry,
  isRefreshInFlight,
  isSessionEnded,
  isRefreshLeaseHeld,
  isTokenExpiringSoon,
  loadCachedSession,
  persistSession,
  shouldAdoptSharedSession,
  refreshAccessTokenOnce,
  SESSION_ENDED_EVENT,
  SESSION_ENDED_STORAGE_KEY,
  SESSION_STORAGE_KEY,
  TokenRefreshTransientError,
  TokenRefreshTransportError,
  type WorkOSSession,
} from '@/services/auth/TokenService';
import { userDataApi } from '@/services/user-data-api';

export type { BlogRole, UserPlan };

/** Ceiling for the session-verification round trip so a hung backend cannot
 *  leave the app on "Loading..." forever (#565). */
const AUTH_VERIFY_TIMEOUT_MS = 15_000;
const TOKEN_REFRESH_MARGIN_MS = 2 * 60 * 1000;
const TOKEN_REFRESH_RETRY_INITIAL_MS = 2 * 1000;
const TOKEN_REFRESH_RETRY_MAX_MS = 60 * 1000;
const TOKEN_REFRESH_RETRY_JITTER_MS = 500;
const TOKEN_OPAQUE_REFRESH_CADENCE_MS = 4 * 60 * 1000;
const REFRESH_SKIP_REPORT_INTERVAL_MS = 10 * 60 * 1000;

type RefreshSkipReason = 'no_refresh_token' | 'no_expiry' | 'not_due' | 'lease_held';
const lastRefreshSkipReportAt = new Map<RefreshSkipReason, number>();

const reportRefreshSkip = (reason: RefreshSkipReason, accessToken?: string): void => {
  if (!accessToken) return;
  const now = Date.now();
  const lastReportedAt = lastRefreshSkipReportAt.get(reason);
  if (lastReportedAt !== undefined && now - lastReportedAt < REFRESH_SKIP_REPORT_INTERVAL_MS) {
    return;
  }
  lastRefreshSkipReportAt.set(reason, now);
  userDataApi.reportClientFailure('auth_refresh_check_skipped', undefined, undefined, {
    message: `reason=${reason}`,
  });
};

// WorkOS User type (compatible with existing code)
interface WorkOSUser {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
}

interface AuthContextType {
  user: WorkOSUser | null;
  session: WorkOSSession | null;
  sessionEnded: boolean;
  loading: boolean;
  /**
   * The auth backend could not be reached (network error, timeout, or 5xx),
   * e.g. mid deploy-swap. The stored session is intact — this is not a
   * sign-out — and the UI should offer a retry (#565).
   */
  connectionError: boolean;
  blogRole: BlogRole | null;
  blogRoleLoading: boolean;
  isBlogAdmin: boolean;
  refreshBlogRole: () => Promise<void>;
  userPlan: UserPlan | null;
  userPlanLoading: boolean;
  userPlanError: boolean;
  refreshUserPlan: () => Promise<void>;
  refreshAuth: () => Promise<void>;
  signUp: (email: string, password: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/** Like useAuth, but returns undefined outside an AuthProvider (for components that render without one). */
export const useOptionalAuth = (): AuthContextType | undefined => useContext(AuthContext);

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<WorkOSUser | null>(null);
  // Hydrate before effects run so the persistence effect cannot clear a valid
  // cached session while the first verification request is awaiting auth.
  const [session, setSession] = useState<WorkOSSession | null>(() => loadCachedSession());
  const [sessionEnded, setSessionEnded] = useState(() => isSessionEnded());
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState(false);
  const sessionRef = React.useRef<WorkOSSession | null>(session);
  sessionRef.current = session;

  // Extract Blog Role and User Plan logic to specialized hooks
  const { blogRole, blogRoleLoading, isBlogAdmin, refreshBlogRole } = useBlogRole({ user });
  const { userPlan, userPlanLoading, userPlanError, refreshUserPlan } = useUserPlan({
    user,
    loading,
  });

  const endSession = useCallback(() => {
    // TokenService clears the browser tokens when it enters the terminal
    // state. Repeat the local state transition here for same-tab and
    // cross-tab notifications, while leaving pending input untouched.
    persistSession(null);
    setSession(null);
    setUser(null);
    setSessionEnded(true);
    setLoading(false);
    markAuthReady();
  }, []);

  // Verify session and load user data
  const refreshAuth = useCallback(async () => {
    // Block all API calls until auth verification completes
    resetAuthGate();
    setLoading(true);
    setConnectionError(false);

    // #565: a transport failure (network error, timeout) or a 5xx is not an
    // auth verdict — the stored session stays intact so a deploy swap cannot
    // sign the player out. The UI surfaces connectionError with a retry.
    // Re-persist: the mount effect writes persistSession(null) while this
    // verification is in flight, so restore the cached pair here.
    const handleTransientFailure = (): void => {
      // Another tab may have rotated the pair while this tab's request was in
      // flight. Re-read storage so a transient failure cannot write the pair
      // captured at the start of this attempt back over the newer one.
      const stored = loadCachedSession();
      if (stored && cachedSession && stored.access_token !== cachedSession.access_token) {
        setSession(stored);
      } else {
        persistSession(cachedSession);
        setSession(cachedSession);
      }
      setConnectionError(true);
      setLoading(false);
      markAuthReady(); // Unblock API calls — they fail fast on their own now
    };

    if (isSessionEnded()) {
      endSession();
      return;
    }

    const cachedSession = loadCachedSession();

    if (!cachedSession) {
      clearSessionEnded();
      setSession(null);
      setUser(null);
      setSessionEnded(false);
      setLoading(false);
      markAuthReady(); // Unblock API calls - no session means user needs to login
      return;
    }

    try {
      // Verify token and get user data from backend
      const verifyToken = async () => {
        // #565: bound the round trip — a blackholed connection must fail,
        // not leave the app on "Loading..." forever.
        const res = await fetchWithAuth('/api/trpc/auth.me', {
          headers: { 'Content-Type': 'application/json' },
          timeoutMs: AUTH_VERIFY_TIMEOUT_MS,
        });
        if (!res.ok) return { ok: false as const, status: res.status };
        const payload = await res.json();
        return { ok: true as const, userData: payload.result?.data };
      };

      let activeSession = cachedSession;
      let result = await verifyToken();
      // fetchWithAuth may have refreshed and persisted the pair while verifying
      // auth.me; do not let the initial cached object overwrite that winner.
      activeSession = loadCachedSession() ?? activeSession;

      // Access token may simply be expired (15 min TTL) — refresh with the
      // stored refresh token before wiping the session. Without this, any
      // page load after idle silently signed the user out and the first
      // API calls raced out with a stale token (cold-load 401 bug).
      if (!result.ok && result.status === 401 && cachedSession.refresh_token) {
        try {
          const newTokens = await refreshAccessTokenOnce(
            cachedSession.refresh_token,
            cachedSession.access_token,
          );
          if (newTokens) {
            // The shared refresh path persists the winning pair before
            // releasing its cross-tab lease. Re-read it so a caller that was
            // queued behind another tab never retries auth.me with a stale
            // pair or publishes the old pair back into storage (#1087).
            const storedSession = loadCachedSession();
            activeSession =
              storedSession && storedSession.access_token !== cachedSession.access_token
                ? storedSession
                : {
                    access_token: newTokens.accessToken,
                    refresh_token: newTokens.refreshToken,
                  };
            persistSession(activeSession);
            result = await verifyToken();
          }
        } catch (error) {
          if (error instanceof TokenRefreshTransportError) {
            handleTransientFailure();
            return;
          }
          throw error;
        }
      }

      if (!result.ok) {
        if (isSessionEnded()) {
          endSession();
          return;
        }

        if (result.status >= 500) {
          // The backend never gave an auth verdict (e.g. deploy swap) —
          // keep the stored session and let the player retry.
          handleTransientFailure();
          return;
        }

        // Token invalid and refresh failed/unavailable, clear session
        clearSessionEnded();
        persistSession(null);
        setSession(null);
        setUser(null);
        setSessionEnded(false);
        setLoading(false);
        markAuthReady(); // Unblock API calls - invalid token, user needs to login
        return;
      }

      const userData = result.userData;

      if (userData) {
        clearSessionEnded();
        setSession(activeSession);
        setSessionEnded(false);
        setConnectionError(false);
        setUser({
          id: userData.id,
          email: userData.email,
          firstName: userData.firstName || null,
          lastName: userData.lastName || null,
        });

        // Dispatch event to signal auth is ready
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('auth-ready', { detail: { user: userData } }));
        }

        markAuthReady(); // Unblock API calls - valid session established
      } else {
        clearSessionEnded();
        markAuthReady(); // Unblock API calls - no user data, app will redirect to login
      }
    } catch (error) {
      logger.error('Error verifying session:', { error });
      if (isSessionEnded()) {
        endSession();
      } else {
        // #565: the backend could not be reached at all — not an auth verdict.
        // Keep the stored session; the UI offers a retry via connectionError.
        clearSessionEnded();
        setSessionEnded(false);
        handleTransientFailure();
      }
    } finally {
      setLoading(false);
    }
  }, [endSession]);

  // Load session and verify on mount
  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  // Listen for token updates from CallbackPage
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleTokensUpdated = (): void => {
      logger.info('Auth tokens updated, refreshing auth state');
      refreshAuth();
    };

    window.addEventListener('auth-tokens-updated', handleTokensUpdated);

    const handleSessionEnded = (): void => {
      endSession();
    };

    window.addEventListener(SESSION_ENDED_EVENT, handleSessionEnded);

    const handleStorageChange = (event: StorageEvent): void => {
      if (event.key === SESSION_ENDED_STORAGE_KEY && event.newValue) {
        endSession();
        return;
      }

      // A refresh in another tab publishes the new pair before releasing its
      // lock. Adopt it locally so this tab does not continue using a stale
      // access token between timer ticks.
      if (event.key !== SESSION_STORAGE_KEY || !event.newValue) return;

      try {
        const nextSession = JSON.parse(event.newValue) as WorkOSSession;
        if (!nextSession.access_token) return;
        // #1249: never adopt an access-only session over a pair that has a
        // refresh token — the writing tab read partial state (fresh tab),
        // and adopting it would spread the drop into this tab's state.
        if (!shouldAdoptSharedSession(sessionRef.current, nextSession)) return;
        clearSessionEnded();
        if (nextSession.refresh_token) {
          window.sessionStorage.setItem('workos_refresh_token', nextSession.refresh_token);
        }
        sessionRef.current = nextSession;
        setSessionEnded(false);
        setSession(nextSession);
      } catch (error) {
        logger.warn('Failed to sync auth session from another tab:', { error });
      }
    };

    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('auth-tokens-updated', handleTokensUpdated);
      window.removeEventListener(SESSION_ENDED_EVENT, handleSessionEnded);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [endSession, refreshAuth]);

  // Auto-refresh token before it expires (WorkOS tokens expire every ~5 minutes).
  // A recursive deadline timer is used instead of relying only on a fixed
  // interval: when a background tab throttles timers, the first callback after
  // visibility is restored still sees the absolute expiry and refreshes.
  const hasAccessToken = Boolean(session?.access_token);
  const hasRefreshToken = Boolean(session?.refresh_token);
  useEffect(() => {
    if (sessionEnded) return;
    if (!hasAccessToken) return;
    if (!hasRefreshToken) {
      reportRefreshSkip('no_refresh_token', session?.access_token);
      return;
    }

    const checkAndRefresh = async (trigger: 'initial' | 'scheduled' | 'event'): Promise<void> => {
      const activeSession = sessionRef.current;
      if (!activeSession?.access_token || isSessionEnded()) return;
      if (!activeSession.refresh_token) {
        reportRefreshSkip('no_refresh_token', activeSession.access_token);
        return;
      }

      const expiry = getTokenExpiry(activeSession.access_token);
      const hasOpaqueExpiry = expiry === null;
      if (hasOpaqueExpiry) {
        // There is no safe deadline to calculate for an opaque token. The
        // scheduled cadence below refreshes it; startup and focus/visibility
        // checks only record the reason they deliberately skip.
        if (trigger !== 'scheduled') {
          reportRefreshSkip('no_expiry', activeSession.access_token);
          return;
        }
      } else if (!isTokenExpiringSoon(activeSession.access_token)) {
        reportRefreshSkip('not_due', activeSession.access_token);
        return;
      }

      if (isRefreshLeaseHeld() && !isRefreshInFlight()) {
        reportRefreshSkip('lease_held', activeSession.access_token);
        scheduleLeaseRetry();
        return;
      }

      logger.info('Access token expiring soon, refreshing...');
      let newTokens: Awaited<ReturnType<typeof refreshAccessTokenOnce>> = null;
      try {
        newTokens = await refreshAccessTokenOnce(
          activeSession.refresh_token,
          activeSession.access_token,
        );
      } catch (error) {
        // #565: transport and temporary HTTP failures are not auth verdicts.
        // Keep the session and back off so every tab does not hammer a
        // recovering refresh endpoint once per second.
        if (
          error instanceof TokenRefreshTransportError ||
          error instanceof TokenRefreshTransientError
        ) {
          scheduleTransientRetry();
        } else {
          logger.error('Unexpected token refresh rejection:', { error });
        }
      }

      if (newTokens) {
        transientFailureCount = 0;
        retryDelayMs = null;
        logger.info('Token refreshed successfully');
        const newSession = {
          access_token: newTokens.accessToken,
          refresh_token: newTokens.refreshToken,
        };
        if (!isSessionEnded()) {
          sessionRef.current = newSession;
          setSession(newSession);
          persistSession(newSession);
        }
      } else if (isSessionEnded()) {
        endSession();
      }
    };

    let refreshTimer: number | null = null;
    let transientFailureCount = 0;
    let retryDelayMs: number | null = null;
    const scheduleTransientRetry = (): void => {
      transientFailureCount += 1;
      const exponentialDelay = Math.min(
        TOKEN_REFRESH_RETRY_MAX_MS,
        TOKEN_REFRESH_RETRY_INITIAL_MS * 2 ** (transientFailureCount - 1),
      );
      retryDelayMs = Math.min(
        TOKEN_REFRESH_RETRY_MAX_MS,
        exponentialDelay + Math.floor(Math.random() * TOKEN_REFRESH_RETRY_JITTER_MS),
      );
    };
    const scheduleLeaseRetry = (): void => {
      retryDelayMs = TOKEN_REFRESH_RETRY_INITIAL_MS;
    };
    const scheduleRefreshCheck = (): void => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      const activeSession = sessionRef.current;
      const expiry = activeSession ? getTokenExpiry(activeSession.access_token) : null;
      const delay =
        retryDelayMs ??
        (expiry
          ? Math.max(1_000, expiry - TOKEN_REFRESH_MARGIN_MS - Date.now())
          : TOKEN_OPAQUE_REFRESH_CADENCE_MS);
      retryDelayMs = null;
      refreshTimer = window.setTimeout(() => {
        void checkAndRefresh('scheduled').finally(scheduleRefreshCheck);
      }, delay);
    };

    // Check immediately, then schedule against the token's absolute expiry.
    void checkAndRefresh('initial').finally(scheduleRefreshCheck);

    const handleFocus = (): void => {
      void checkAndRefresh('event').finally(scheduleRefreshCheck);
    };
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') {
        void checkAndRefresh('event').finally(scheduleRefreshCheck);
      }
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [endSession, hasAccessToken, hasRefreshToken, session?.access_token, sessionEnded]);

  // Persist session to localStorage
  useEffect(() => {
    persistSession(session);
  }, [session]);

  // WorkOS uses hosted UI - these functions redirect to WorkOS
  const signUp = useCallback(async (_email: string, _password: string) => {
    const apiUrl = import.meta.env?.VITE_API_URL || '';
    window.location.href = `${apiUrl}/v1/auth/login`;
    return { error: null };
  }, []);

  const signIn = useCallback(async (_email: string, _password: string) => {
    const apiUrl = import.meta.env?.VITE_API_URL || '';
    window.location.href = `${apiUrl}/v1/auth/login`;
    return { error: null };
  }, []);

  const signOut = useCallback(async () => {
    try {
      const apiUrl = import.meta.env?.VITE_API_URL || '';
      const accessToken = session?.access_token;

      // Clear local session first
      persistSession(null);
      setSession(null);
      setUser(null);

      // Extract session ID from JWT token
      if (accessToken) {
        try {
          // Decode JWT (format: header.payload.signature)
          const parts = accessToken.split('.');
          if (parts.length === 3) {
            const payload = JSON.parse(atob(parts[1]));
            const sessionId = payload.sid;

            if (sessionId) {
              // Redirect to backend logout endpoint which will redirect to WorkOS
              window.location.href = `${apiUrl}/v1/auth/logout?session_id=${sessionId}`;
              return;
            }
          }
        } catch (decodeError) {
          logger.warn('Failed to decode token for logout:', decodeError);
        }
      }

      // Fallback: if no session or decode fails, just redirect home
      window.location.href = '/';
    } catch (error) {
      logger.error('Error signing out:', error);
      window.location.href = '/';
    }
  }, [session?.access_token]);

  // ⚡ Bolt: Stabilize context value to prevent unnecessary re-renders of consumers.
  const value = useMemo(
    () => ({
      user,
      session,
      sessionEnded,
      loading,
      connectionError,
      blogRole,
      blogRoleLoading,
      isBlogAdmin,
      refreshBlogRole,
      userPlan,
      userPlanLoading,
      userPlanError,
      refreshUserPlan,
      refreshAuth,
      signUp,
      signIn,
      signOut,
    }),
    [
      user,
      session,
      sessionEnded,
      loading,
      connectionError,
      blogRole,
      blogRoleLoading,
      isBlogAdmin,
      refreshBlogRole,
      userPlan,
      userPlanLoading,
      userPlanError,
      refreshUserPlan,
      refreshAuth,
      signUp,
      signIn,
      signOut,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
