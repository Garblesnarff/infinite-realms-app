import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { useBlogRole, type BlogRole } from '@/hooks/auth/use-blog-role';
import { useUserPlan, type UserPlan } from '@/hooks/auth/use-user-plan';
import { resetAuthGate, markAuthReady } from '@/lib/auth-gate';
import logger from '@/lib/logger';
import {
  isTokenExpiringSoon,
  loadCachedSession,
  persistSession,
  refreshAccessToken,
  type WorkOSSession,
} from '@/services/auth/TokenService';

export type { BlogRole, UserPlan };

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
  loading: boolean;
  blogRole: BlogRole | null;
  blogRoleLoading: boolean;
  isBlogAdmin: boolean;
  refreshBlogRole: () => Promise<void>;
  userPlan: UserPlan | null;
  userPlanLoading: boolean;
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
  const [session, setSession] = useState<WorkOSSession | null>(null);
  const [loading, setLoading] = useState(true);

  // Extract Blog Role and User Plan logic to specialized hooks
  const { blogRole, blogRoleLoading, isBlogAdmin, refreshBlogRole } = useBlogRole({ user });
  const { userPlan, userPlanLoading, refreshUserPlan } = useUserPlan({ user, loading });

  // Verify session and load user data
  const refreshAuth = useCallback(async () => {
    // Block all API calls until auth verification completes
    resetAuthGate();
    setLoading(true);
    const cachedSession = loadCachedSession();

    if (!cachedSession) {
      setLoading(false);
      markAuthReady(); // Unblock API calls - no session means user needs to login
      return;
    }

    try {
      // Verify token and get user data from backend
      const apiUrl = import.meta.env?.VITE_API_URL || '';
      const response = await fetch(`${apiUrl}/api/trpc/auth.me`, {
        headers: {
          Authorization: `Bearer ${cachedSession.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        // Token invalid, clear session
        persistSession(null);
        setSession(null);
        setUser(null);
        setLoading(false);
        markAuthReady(); // Unblock API calls - invalid token, user needs to login
        return;
      }

      const data = await response.json();
      const userData = data.result?.data;

      if (userData) {
        setSession(cachedSession);
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
        markAuthReady(); // Unblock API calls - no user data, app will redirect to login
      }
    } catch (error) {
      logger.error('Error verifying session:', error);
      persistSession(null);
      markAuthReady(); // Unblock API calls even on error
    } finally {
      setLoading(false);
    }
  }, []);

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

    return () => {
      window.removeEventListener('auth-tokens-updated', handleTokensUpdated);
    };
  }, [refreshAuth]);

  // Auto-refresh token before it expires (WorkOS tokens expire every ~5 minutes)
  useEffect(() => {
    if (!session?.access_token || !session?.refresh_token) return;

    const checkAndRefresh = async (): Promise<void> => {
      if (!session?.access_token || !session?.refresh_token) return;

      if (isTokenExpiringSoon(session.access_token)) {
        logger.info('Access token expiring soon, refreshing...');
        const newTokens = await refreshAccessToken(session.refresh_token);

        if (newTokens) {
          logger.info('Token refreshed successfully');
          const newSession = {
            access_token: newTokens.accessToken,
            refresh_token: newTokens.refreshToken,
          };
          setSession(newSession);
          persistSession(newSession);
        } else {
          logger.warn('Token refresh failed, user may need to re-login');
        }
      }
    };

    // Check immediately
    checkAndRefresh();

    // Then check every 30 seconds
    const interval = setInterval(checkAndRefresh, 30 * 1000);

    return () => clearInterval(interval);
  }, [session?.access_token, session?.refresh_token]);

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
      loading,
      blogRole,
      blogRoleLoading,
      isBlogAdmin,
      refreshBlogRole,
      userPlan,
      userPlanLoading,
      refreshUserPlan,
      refreshAuth,
      signUp,
      signIn,
      signOut,
    }),
    [
      user,
      session,
      loading,
      blogRole,
      blogRoleLoading,
      isBlogAdmin,
      refreshBlogRole,
      userPlan,
      userPlanLoading,
      refreshUserPlan,
      refreshAuth,
      signUp,
      signIn,
      signOut,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
