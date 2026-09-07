import logger from '@/lib/logger';

// WorkOS Session type (simplified, compatible with access_token usage)
export interface WorkOSSession {
  access_token: string;
  refresh_token?: string;
}

export interface AccessTokenPair {
  accessToken: string;
  refreshToken: string;
}

export const SESSION_STORAGE_KEY = 'aas_workos_cached_session';
export const SESSION_ENDED_STORAGE_KEY = 'aas_workos_session_ended';
export const SESSION_ENDED_EVENT = 'workos-session-ended';
export const SESSION_ENDED_MESSAGE = 'Session ended — sign in again';
export const PENDING_INPUT_STORAGE_KEY = 'aas_workos_pending_input';
export const TOKEN_REFRESH_MARGIN_MS = 60 * 1000; // Refresh 1 minute before expiry
const TOKEN_REFRESH_LOCK_NAME = 'aas-workos-token-refresh';
const TOKEN_REFRESH_LEASE_KEY = 'aas_workos_token_refresh_lease';
const TOKEN_REFRESH_LEASE_MS = 10 * 1000;
const TOKEN_REFRESH_LEASE_RENEW_MS = 3 * 1000;
const TOKEN_REFRESH_LEASE_POLL_MS = 50;

type RefreshResult = AccessTokenPair | null;
type StoredRefreshLease = { owner: string; expiresAt: number };

let refreshInFlight: Promise<RefreshResult> | null = null;
let sessionEnded = false;
let headlessSession: WorkOSSession | null = null;

export class TokenRefreshError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'TokenRefreshError';
    this.status = status;
    this.code = code;
  }
}

const readSession = (raw: string | null): WorkOSSession | null => {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<WorkOSSession>;
    if (typeof parsed.access_token !== 'string' || !parsed.access_token) return null;
    if (parsed.refresh_token !== undefined && typeof parsed.refresh_token !== 'string') return null;
    return parsed as WorkOSSession;
  } catch {
    return null;
  }
};

const readSharedSession = (): WorkOSSession | null => {
  if (typeof window === 'undefined') return null;
  return readSession(window.localStorage.getItem(SESSION_STORAGE_KEY));
};

const createRefreshResult = (session: WorkOSSession): AccessTokenPair | null => {
  if (!session.refresh_token) return null;
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
  };
};

const getSharedRefreshResult = (
  refreshToken: string,
  currentAccessToken?: string,
): AccessTokenPair | null => {
  const sharedSession = readSharedSession();
  if (!sharedSession?.refresh_token) return null;

  // A tab that waited for the lock must adopt the pair the previous holder
  // published instead of replaying the single-use refresh token. WorkOS
  // normally rotates both values; the access-token comparison also covers a
  // provider that keeps the refresh token stable while rotating access tokens.
  const refreshTokenChanged = sharedSession.refresh_token !== refreshToken;
  const accessTokenChanged =
    Boolean(currentAccessToken) && sharedSession.access_token !== currentAccessToken;
  if (!refreshTokenChanged && !accessTokenChanged) return null;

  return createRefreshResult(sharedSession);
};

const getLockManager = (): {
  request: <T>(
    name: string,
    options: { mode: 'exclusive' },
    callback: () => Promise<T>,
  ) => Promise<T>;
} | null => {
  if (typeof navigator === 'undefined') return null;
  const candidate = (navigator as Navigator & { locks?: unknown }).locks;
  if (!candidate || typeof (candidate as { request?: unknown }).request !== 'function') return null;
  return candidate as {
    request: <T>(
      name: string,
      options: { mode: 'exclusive' },
      callback: () => Promise<T>,
    ) => Promise<T>;
  };
};

const readRefreshLease = (): StoredRefreshLease | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(TOKEN_REFRESH_LEASE_KEY);
    if (!raw) return null;
    const lease = JSON.parse(raw) as Partial<StoredRefreshLease>;
    if (typeof lease.owner !== 'string' || typeof lease.expiresAt !== 'number') return null;
    return lease as StoredRefreshLease;
  } catch {
    return null;
  }
};

const waitForRefreshLease = (): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, TOKEN_REFRESH_LEASE_POLL_MS);
  });

const withLocalStorageLease = async <T>(work: () => Promise<T>): Promise<T> => {
  if (typeof window === 'undefined') return work();

  const owner = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  while (true) {
    const now = Date.now();
    const current = readRefreshLease();

    if (!current || current.expiresAt <= now) {
      const candidate: StoredRefreshLease = {
        owner,
        expiresAt: now + TOKEN_REFRESH_LEASE_MS,
      };
      window.localStorage.setItem(TOKEN_REFRESH_LEASE_KEY, JSON.stringify(candidate));

      // Re-read after writing. This confirmation prevents a waiting tab from
      // proceeding when another tab replaced the lease between our read/write.
      if (readRefreshLease()?.owner === owner) {
        const renewLease = window.setInterval(() => {
          if (readRefreshLease()?.owner !== owner) return;
          window.localStorage.setItem(
            TOKEN_REFRESH_LEASE_KEY,
            JSON.stringify({ owner, expiresAt: Date.now() + TOKEN_REFRESH_LEASE_MS }),
          );
        }, TOKEN_REFRESH_LEASE_RENEW_MS);

        try {
          return await work();
        } finally {
          window.clearInterval(renewLease);
          if (readRefreshLease()?.owner === owner) {
            window.localStorage.removeItem(TOKEN_REFRESH_LEASE_KEY);
          }
        }
      }
    }

    await waitForRefreshLease();
  }
};

const withRefreshLock = <T>(work: () => Promise<T>): Promise<T> => {
  const locks = getLockManager();
  if (locks) {
    return locks.request(TOKEN_REFRESH_LOCK_NAME, { mode: 'exclusive' }, work);
  }
  return withLocalStorageLease(work);
};

export const isSessionEnded = (): boolean => {
  if (sessionEnded) return true;
  if (typeof window === 'undefined') return false;
  return Boolean(window.localStorage.getItem(SESSION_ENDED_STORAGE_KEY));
};

export const clearSessionEnded = (): void => {
  sessionEnded = false;
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(SESSION_ENDED_STORAGE_KEY);
  }
};

const markSessionEnded = (error: unknown): void => {
  if (isSessionEnded()) return;

  sessionEnded = true;
  persistSession(null);

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(SESSION_ENDED_STORAGE_KEY, String(Date.now()));
    window.dispatchEvent(new CustomEvent(SESSION_ENDED_EVENT, { detail: { error } }));
  }
};

const isTerminalRefreshFailure = (error: TokenRefreshError): boolean => {
  const details = `${error.code ?? ''} ${error.message}`.toLowerCase();
  return error.status === 401 || details.includes('invalid_grant');
};

const getPayloadString = (payload: unknown, key: string): string | undefined => {
  if (!payload || typeof payload !== 'object') return undefined;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' && value ? value : undefined;
};

const getRefreshError = (payload: unknown, status: number): TokenRefreshError => {
  const code =
    getPayloadString(payload, 'code') ||
    getPayloadString(payload, 'error_code') ||
    getPayloadString(payload, 'error');
  const message =
    getPayloadString(payload, 'error_description') ||
    getPayloadString(payload, 'message') ||
    (code === 'invalid_grant' ? 'invalid_grant' : undefined) ||
    `Token refresh failed with status ${status}`;
  return new TokenRefreshError(message, status, code);
};

const readResponseJson = async (response: Response): Promise<unknown> => {
  if (typeof response.json !== 'function') return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
};

/** Configure the browser API clients for a Bun/CLI host without a DOM. */
export const configureHeadlessSession = (session: WorkOSSession | null): void => {
  headlessSession = session;
  if (session) clearSessionEnded();
};

/**
 * Read the current WorkOS access token from browser storage.
 *
 * Keeping the storage access here prevents API callers from depending on the
 * storage key or on browser globals directly.
 */
export const getAccessToken = (): string | null => {
  if (headlessSession) return headlessSession.access_token;
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem('workos_access_token');
};

/**
 * Build the WorkOS authorization header for requests that allow anonymous access.
 * Set `includeEmptyToken` only for legacy callers that intentionally sent an
 * empty Bearer token when no authenticated session was available.
 */
export const getAuthHeaders = ({
  includeEmptyToken = false,
}: { includeEmptyToken?: boolean } = {}): Record<string, string> => {
  const accessToken = getAccessToken();
  if (!accessToken && !includeEmptyToken) return {};
  return { Authorization: `Bearer ${accessToken ?? ''}` };
};

/**
 * Decode JWT and extract expiration time
 */
export const getTokenExpiry = (token: string): number | null => {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64Payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const paddedPayload = base64Payload.padEnd(
      base64Payload.length + ((4 - (base64Payload.length % 4)) % 4),
      '=',
    );
    const payload = JSON.parse(atob(paddedPayload)) as { exp?: unknown };
    const expiryInSeconds = Number(payload.exp);
    if (!Number.isFinite(expiryInSeconds) || expiryInSeconds <= 0) return null;
    return expiryInSeconds * 1000; // Convert to milliseconds
  } catch {
    return null;
  }
};

/**
 * Check if token is expired or about to expire
 */
export const isTokenExpiringSoon = (token: string): boolean => {
  const expiry = getTokenExpiry(token);
  // Some WorkOS access tokens are opaque. Without a trustworthy expiry claim,
  // do not treat every timer tick/render as a refresh instruction; the API
  // validation path will refresh an actually expired token instead.
  if (!expiry) return false;
  return Date.now() >= expiry - TOKEN_REFRESH_MARGIN_MS;
};

const requestTokenRefresh = async (refreshToken: string): Promise<RefreshResult> => {
  try {
    const apiUrl = import.meta.env?.VITE_API_URL || '';
    const response = await fetch(`${apiUrl}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      const payload = await readResponseJson(response);
      const error = getRefreshError(payload, response.status);
      logger.warn('Token refresh failed:', { status: response.status, error });
      if (isTerminalRefreshFailure(error)) markSessionEnded(error);
      return null;
    }

    const data = (await readResponseJson(response)) as Record<string, unknown> | null;
    const responseError = getRefreshError(data, response.status);
    if (isTerminalRefreshFailure(responseError)) {
      logger.warn('Token refresh failed:', { status: response.status, error: responseError });
      markSessionEnded(responseError);
      return null;
    }

    if (!data || typeof data.accessToken !== 'string' || typeof data.refreshToken !== 'string') {
      const error = new TokenRefreshError(
        'Token refresh returned an invalid payload',
        response.status,
      );
      logger.error('Token refresh returned an invalid payload:', { error });
      return null;
    }

    return {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    };
  } catch (error) {
    logger.error('Error refreshing token:', { error });
    return null;
  }
};

const refreshWithCoordination = async (
  refreshToken: string,
  currentAccessToken?: string,
): Promise<RefreshResult> => {
  return withRefreshLock(async () => {
    if (isSessionEnded()) return null;

    // If another tab completed the exchange while this tab waited for the
    // lock, use its published pair. Replaying the old refresh token would
    // race WorkOS's rotation and end the session with invalid_grant.
    const sharedTokens = getSharedRefreshResult(refreshToken, currentAccessToken);
    if (sharedTokens) {
      persistSession({
        access_token: sharedTokens.accessToken,
        refresh_token: sharedTokens.refreshToken,
      });
      return sharedTokens;
    }

    const tokens = await requestTokenRefresh(refreshToken);
    if (tokens) {
      // Publish before releasing the cross-tab lock so the next tab adopts
      // these tokens instead of making a second exchange.
      persistSession({ access_token: tokens.accessToken, refresh_token: tokens.refreshToken });
    }
    return tokens;
  });
};

/** Serialize every refresh caller so rotating refresh tokens are never raced. */
export const refreshAccessToken = (
  refreshToken: string,
  currentAccessToken?: string,
): Promise<RefreshResult> => {
  if (isSessionEnded()) return Promise.resolve(null);

  if (!refreshInFlight) {
    const coordinatedRefresh = refreshWithCoordination(refreshToken, currentAccessToken).catch(
      (error: unknown) => {
        logger.error('Token refresh coordination failed:', { error });
        return null;
      },
    );
    refreshInFlight = coordinatedRefresh.finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
};

// Kept as a named alias for existing 401-retry callers. Both entry points use
// the same shared promise above, so no caller can bypass single-flight.
export const refreshAccessTokenOnce = refreshAccessToken;

export const loadCachedSession = (): WorkOSSession | null => {
  if (headlessSession) return headlessSession;
  if (typeof window === 'undefined') return null;

  // Check for tokens in localStorage (set by CallbackPage)
  const accessToken = getAccessToken();
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
  const cachedSession = readSession(raw);
  if (!cachedSession) {
    logger.warn('Failed to parse cached session', { error: new Error('Invalid cached session') });
    return null;
  }
  return cachedSession;
};

export const loadPendingInput = (): string => {
  if (typeof window === 'undefined') return '';
  try {
    return window.sessionStorage.getItem(PENDING_INPUT_STORAGE_KEY) || '';
  } catch {
    return '';
  }
};

export const savePendingInput = (input: string): void => {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(PENDING_INPUT_STORAGE_KEY, input);
  } catch {
    // A blocked sessionStorage should not prevent the player from sending.
  }
};

export const clearPendingInput = (): void => {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(PENDING_INPUT_STORAGE_KEY);
  } catch {
    // A blocked sessionStorage should not prevent the player from sending.
  }
};

export const persistSession = (session: WorkOSSession | null): void => {
  if (typeof window === 'undefined') {
    headlessSession = session;
    if (session) clearSessionEnded();
    return;
  }
  if (session) {
    clearSessionEnded();
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
