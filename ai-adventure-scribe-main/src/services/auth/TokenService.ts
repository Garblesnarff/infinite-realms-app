import logger from '@/lib/logger';

// WorkOS Session type (simplified, compatible with access_token usage)
export interface WorkOSSession {
  access_token: string;
  refresh_token?: string;
}

export const SESSION_STORAGE_KEY = 'aas_workos_cached_session';
export const TOKEN_REFRESH_MARGIN_MS = 60 * 1000; // Refresh 1 minute before expiry

/**
 * Decode JWT and extract expiration time
 */
export const getTokenExpiry = (token: string): number | null => {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]));
    return payload.exp ? payload.exp * 1000 : null; // Convert to milliseconds
  } catch {
    return null;
  }
};

/**
 * Check if token is expired or about to expire
 */
export const isTokenExpiringSoon = (token: string): boolean => {
  const expiry = getTokenExpiry(token);
  if (!expiry) return true; // Treat unparseable tokens as expired
  return Date.now() >= expiry - TOKEN_REFRESH_MARGIN_MS;
};

/**
 * Refresh the access token using the refresh token
 */
export const refreshAccessToken = async (
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string } | null> => {
  try {
    const apiUrl = import.meta.env?.VITE_API_URL || '';
    const response = await fetch(`${apiUrl}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      logger.warn('Token refresh failed:', response.status);
      return null;
    }

    const data = await response.json();
    return {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    };
  } catch (error) {
    logger.error('Error refreshing token:', error);
    return null;
  }
};

export const loadCachedSession = (): WorkOSSession | null => {
  if (typeof window === 'undefined') return null;

  // Check for tokens in localStorage (set by CallbackPage)
  const accessToken = window.localStorage.getItem('workos_access_token');
  const refreshToken =
    window.sessionStorage.getItem('workos_refresh_token') ||
    window.localStorage.getItem('workos_refresh_token');

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

export const persistSession = (session: WorkOSSession | null) => {
  if (typeof window === 'undefined') return;
  if (session) {
    window.localStorage.setItem('workos_access_token', session.access_token);
    if (session.refresh_token) {
      // Keep refresh token scoped to browser session to reduce persistence risk.
      window.sessionStorage.setItem('workos_refresh_token', session.refresh_token);
      window.localStorage.removeItem('workos_refresh_token');
    } else {
      window.sessionStorage.removeItem('workos_refresh_token');
      window.localStorage.removeItem('workos_refresh_token');
    }
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } else {
    window.localStorage.removeItem('workos_access_token');
    window.localStorage.removeItem('workos_refresh_token');
    window.sessionStorage.removeItem('workos_refresh_token');
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  }
};
