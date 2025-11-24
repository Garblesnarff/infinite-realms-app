import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import logger from '@/lib/logger';
import { trpc } from '@/lib/trpc/client';
import { addNetworkListener, isOffline } from '@/utils/network';

export type BlogRole = 'admin' | 'editor' | 'author' | 'contributor' | 'viewer';
export type UserPlan = 'free' | 'pro' | 'enterprise';

// WorkOS User type (compatible with existing code)
interface WorkOSUser {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
}

// WorkOS Session type (simplified, compatible with access_token usage)
interface WorkOSSession {
  access_token: string;
  refresh_token?: string;
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

const SESSION_STORAGE_KEY = 'aas_workos_cached_session';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const loadCachedSession = (): WorkOSSession | null => {
  if (typeof window === 'undefined') return null;

  // Check for tokens in localStorage (set by CallbackPage)
  const accessToken = window.localStorage.getItem('workos_access_token');
  const refreshToken = window.localStorage.getItem('workos_refresh_token');

  if (accessToken) {
    return {
      access_token: accessToken,
      refresh_token: refreshToken || undefined,
    };
  }

  // Fallback to old cached session
  const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as WorkOSSession;
  } catch (error) {
    logger.warn('Failed to parse cached session', error);
    return null;
  }
};

const persistSession = (session: WorkOSSession | null) => {
  if (typeof window === 'undefined') return;
  if (session) {
    window.localStorage.setItem('workos_access_token', session.access_token);
    if (session.refresh_token) {
      window.localStorage.setItem('workos_refresh_token', session.refresh_token);
    }
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } else {
    window.localStorage.removeItem('workos_access_token');
    window.localStorage.removeItem('workos_refresh_token');
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  }
};

export const useAuth = () => {
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
  const [blogRole, setBlogRole] = useState<BlogRole | null>(null);
  const [blogRoleLoading, setBlogRoleLoading] = useState(false);
  const [userPlan, setUserPlan] = useState<UserPlan | null>(null);
  const [userPlanLoading, setUserPlanLoading] = useState(false);
  const hasBootstrapped = useRef(false);

  // Verify session and load user data
  const refreshAuth = useCallback(async () => {
    setLoading(true);
    const cachedSession = loadCachedSession();

    if (!cachedSession) {
      setLoading(false);
      return;
    }

    try {
      // Verify token and get user data from backend
      const apiUrl = (import.meta as any).env?.VITE_API_URL || '';
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
      }
    } catch (error) {
      logger.error('Error verifying session:', error);
      persistSession(null);
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

    const handleTokensUpdated = () => {
      logger.info('Auth tokens updated, refreshing auth state');
      refreshAuth();
    };

    window.addEventListener('auth-tokens-updated', handleTokensUpdated);

    return () => {
      window.removeEventListener('auth-tokens-updated', handleTokensUpdated);
    };
  }, [refreshAuth]);

  // Persist session to localStorage
  useEffect(() => {
    persistSession(session);
  }, [session]);

  // Clear blog role and user plan when user logs out
  useEffect(() => {
    if (!user) {
      setBlogRole(null);
      setBlogRoleLoading(false);
      setUserPlan(null);
      setUserPlanLoading(false);
    }
  }, [user]);

  const fetchBlogRole = useCallback(async () => {
    if (!user) {
      setBlogRole(null);
      setBlogRoleLoading(false);
      return;
    }

    if (isOffline()) {
      setBlogRoleLoading(false);
      return;
    }

    setBlogRoleLoading(true);
    try {
      // Dev override: allow admin access in non-production without email setup
      const devAdminEmail = (import.meta as any)?.env?.VITE_DEV_BLOG_ADMIN_EMAIL as
        | string
        | undefined;
      const devOverrideRaw = (import.meta as any)?.env?.VITE_BLOG_ADMIN_DEV_OVERRIDE as
        | string
        | undefined;
      const isDev = (import.meta as any)?.env?.MODE !== 'production';
      const enableDevOverride =
        devOverrideRaw === 'true' ||
        devOverrideRaw === '1' ||
        (devOverrideRaw === undefined && !devAdminEmail);
      if (isDev && enableDevOverride) {
        setBlogRole('admin');
        return;
      }
      // If a specific dev admin email is set, grant admin for that user
      if (
        isDev &&
        devAdminEmail &&
        user.email &&
        user.email.toLowerCase() === devAdminEmail.toLowerCase()
      ) {
        setBlogRole('admin');
        return;
      }

      // TODO: Implement blog role fetching via tRPC or API call
      // For now, default to null
      setBlogRole(null);
    } catch (error) {
      logger.warn('Failed to load blog role', error);
      setBlogRole(null);
    } finally {
      setBlogRoleLoading(false);
    }
  }, [user]);

  const fetchUserPlan = useCallback(async () => {
    if (!user || !session?.access_token) {
      setUserPlan(null);
      setUserPlanLoading(false);
      return;
    }

    if (isOffline()) {
      setUserPlanLoading(false);
      return;
    }

    setUserPlanLoading(true);
    try {
      const apiUrl = (import.meta as any).env?.VITE_API_URL || '';
      const response = await fetch(`${apiUrl}/v1/llm/quota`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch user plan');
      }

      const data = await response.json();
      setUserPlan((data.plan as UserPlan) || 'free');
    } catch (error) {
      logger.warn('Failed to load user plan', error);
      setUserPlan('free'); // Default to free on error
    } finally {
      setUserPlanLoading(false);
    }
  }, [user, session]);

  useEffect(() => {
    if (!user) return;
    fetchBlogRole();
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    fetchUserPlan();
  }, [user?.id, session?.access_token]);

  // WorkOS uses hosted UI - these functions redirect to WorkOS
  const signUp = async (email: string, password: string) => {
    const apiUrl = (import.meta as any).env?.VITE_API_URL || '';
    window.location.href = `${apiUrl}/v1/auth/login`;
    return { error: null };
  };

  const signIn = async (email: string, password: string) => {
    const apiUrl = (import.meta as any).env?.VITE_API_URL || '';
    window.location.href = `${apiUrl}/v1/auth/login`;
    return { error: null };
  };

  const signOut = async () => {
    try {
      const apiUrl = (import.meta as any).env?.VITE_API_URL || '';
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
  };

  const value = {
    user,
    session,
    loading,
    blogRole,
    blogRoleLoading,
    isBlogAdmin: blogRole === 'admin',
    refreshBlogRole: fetchBlogRole,
    userPlan,
    userPlanLoading,
    refreshUserPlan: fetchUserPlan,
    refreshAuth,
    signUp,
    signIn,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
