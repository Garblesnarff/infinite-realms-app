import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { useBlogRole, type BlogRole } from '@/hooks/auth/use-blog-role';
import { useUserPlan, type UserPlan } from '@/hooks/auth/use-user-plan';
import { fetchWithAuth } from '@/infrastructure/api/rest-client';
import { resetAuthGate, markAuthReady } from '@/lib/auth-gate';
import logger from '@/lib/logger';
import {
  clearSessionEnded,
  getTokenExpiry,
  isSessionEnded,
  isTokenExpiringSoon,
  loadCachedSession,
  persistSession,
  refreshAccessTokenOnce,
  SESSION_ENDED_EVENT,
  SESSION_ENDED_STORAGE_KEY,
  SESSION_STORAGE_KEY,
  TokenRefreshTransportError,
  type WorkOSSession,
} from '@/services/auth/TokenService';

export type { BlogRole, UserPlan };

/** Ceiling for the session-verification round trip so a hung backend cannot
 *  leave the app on "Loading..." forever (#565). */
const AUTH_VERIFY_TIMEOUT_MS = 15_000;
const TOKEN_REFRESH_MARGIN_MS = 2 * 60 * 1000;

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
      persistSession(cachedSession);
      setSession(cachedSession);
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
  const hasRefreshToken = Boolean(session?.refresh_token);
  useEffect(() => {
    if (!hasRefreshToken || sessionEnded) return;

    const checkAndRefresh = async (): Promise<void> => {
      const activeSession = sessionRef.current;
      if (!activeSession?.access_token || !activeSession.refresh_token || isSessionEnded()) return;

      if (isTokenExpiringSoon(activeSession.access_token)) {
        logger.info('Access token expiring soon, refreshing...');
        let newTokens: Awaited<ReturnType<typeof refreshAccessTokenOnce>> = null;
        try {
          newTokens = await refreshAccessTokenOnce(
            activeSession.refresh_token,
            activeSession.access_token,
          );
        } catch (error) {
          // #565: the refresh endpoint is unreachable (deploy swap) — not an
          // auth verdict. Leave the session alone; the next tick retries.
          if (!(error instanceof TokenRefreshTransportError)) {
            logger.error('Unexpected token refresh rejection:', { error });
          }
        }

        if (newTokens) {
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
      }
    };

    let refreshTimer: number | null = null;
    const scheduleRefreshCheck = (): void => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      const activeSession = sessionRef.current;
      const expiry = activeSession ? getTokenExpiry(activeSession.access_token) : null;
      const delay = expiry
        ? Math.max(1_000, expiry - TOKEN_REFRESH_MARGIN_MS - Date.now())
        : 30 * 1000;
      refreshTimer = window.setTimeout(() => {
        void checkAndRefresh().finally(scheduleRefreshCheck);
      }, delay);
    };

    // Check immediately, then schedule against the token's absolute expiry.
    void checkAndRefresh().finally(scheduleRefreshCheck);

    const handleFocus = (): void => {
      void checkAndRefresh().finally(scheduleRefreshCheck);
    };
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') {
        void checkAndRefresh().finally(scheduleRefreshCheck);
      }
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [endSession, hasRefreshToken, sessionEnded]);

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
