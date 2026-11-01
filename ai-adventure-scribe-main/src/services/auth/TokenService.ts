import { fetchWithTimeout } from '@/infrastructure/api/fetch-with-timeout';
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
export const SESSION_ENDED_MESSAGE = 'Your sign-in expired — sign in again; your game is saved';
export const PENDING_INPUT_STORAGE_KEY = 'aas_workos_pending_input';
export const TOKEN_REFRESH_MARGIN_MS = 2 * 60 * 1000; // Refresh 2 minutes before expiry
const TOKEN_REFRESH_LOCK_NAME = 'aas-workos-token-refresh';
const TOKEN_REFRESH_LEASE_KEY = 'aas_workos_token_refresh_lease';
const TOKEN_REFRESH_LEASE_MS = 10 * 1000;
const TOKEN_REFRESH_LEASE_RENEW_MS = 3 * 1000;
const TOKEN_REFRESH_LEASE_POLL_MS = 50;
const TOKEN_REFRESH_LEASE_SETTLE_MS = 40;
/** Overall ceiling for waiting on the refresh exchange: the deadline stops waiting and aborts the fetch signal — which cancels the request only before headers arrive; a body already being read runs under its own 30 s budget, so a late success can still settle (#1087, #1263, #1275). */
export const TOKEN_REFRESH_OVERALL_TIMEOUT_MS = 20_000;

type RefreshResult = AccessTokenPair | null;
type StoredRefreshLease = { owner: string; expiresAt: number };

let refreshInFlight: Promise<RefreshResult> | null = null;
/**
 * Deadline-fired exchanges that may still settle (#1263, #1275). A list, not
 * a single slot: a second deadline before the first settles must not drop
 * the first entry unawaited. Entries remove themselves when they settle, and
 * the body budget (below) bounds every entry's lifetime, so the list cannot
 * grow past the exchanges still inside their budgets.
 */
const pendingLateWork: Set<Promise<RefreshResult>> = new Set();

/** Test-only: drop pending late-work entries so tests cannot leak slot state (#1275). */
export const clearPendingLateWorkForTests = (): void => {
  pendingLateWork.clear();
};
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

/**
 * The refresh endpoint could not be reached at all (network error or timeout),
 * e.g. mid deploy-swap. This is a transport failure, not an auth verdict: the
 * stored session must stay intact and callers must not report session-expired
 * (#565).
 */
export class TokenRefreshTransportError extends Error {
  constructor(message = 'Token refresh endpoint unreachable') {
    super(message);
    this.name = 'TokenRefreshTransportError';
  }
}

/** The refresh endpoint answered, but temporarily cannot complete the exchange. */
export class TokenRefreshTransientError extends TokenRefreshError {
  constructor(message: string, status: number, code?: string) {
    super(message, status, code);
    this.name = 'TokenRefreshTransientError';
  }
}

/** True for failures that mean "no answer", never "the server rejected us". */
const isTransportFailure = (error: unknown): boolean => {
  const name =
    error && typeof error === 'object' && 'name' in error
      ? (error as { name?: unknown }).name
      : undefined;
  if (name === 'AbortError') return true;
  return (
    error instanceof TypeError &&
    /failed to fetch|network(?:error| error)|load failed/i.test(error.message)
  );
};

/** Ceiling for the refresh POST so a hung endpoint cannot stall auth forever (#565). */
const TOKEN_REFRESH_REQUEST_TIMEOUT_MS = 15_000;

/**
 * Ceiling for reading one refresh response body (#1275). The fetch timeout
 * clears once headers arrive and the 20 s deadline only stops the waiter, so
 * without this a body that never settles would leave the late-work slot set
 * forever. 30 s preserves the pinned #1263 late adoption (bodies resolving
 * within ~20 s of headers) while guaranteeing every entry settles.
 */
export const TOKEN_REFRESH_BODY_TIMEOUT_MS = 30_000;

const withRefreshDeadline = async <T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> => {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new TokenRefreshTransportError('Token refresh exceeded its overall deadline'));
    }, TOKEN_REFRESH_OVERALL_TIMEOUT_MS);
  });

  try {
    return await Promise.race([work(controller.signal), deadline]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
};

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

/** Whether a cross-tab refresh lease is currently present. */
export const isRefreshLeaseHeld = (): boolean => {
  const lease = readRefreshLease();
  return Boolean(lease && lease.expiresAt > Date.now());
};

/** Whether this tab already owns an in-flight refresh promise. */
export const isRefreshInFlight = (): boolean => refreshInFlight !== null;

const waitForRefreshLease = (): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, TOKEN_REFRESH_LEASE_POLL_MS);
  });

const waitForRefreshLeaseSettle = (): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, TOKEN_REFRESH_LEASE_SETTLE_MS);
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

      // Let competing tabs observe this write before the final ownership
      // check. Storage writes are not a compare-and-swap operation.
      await waitForRefreshLeaseSettle();

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
  // Web Locks can remain queued indefinitely when a background tab is frozen
  // while holding the lock. The storage lease has a bounded expiry and is
  // renewed while the refresh is active, so another visible tab can recover
  // after the frozen owner stops renewing (#1087).
  if (typeof window !== 'undefined') return withLocalStorageLease(work);

  const locks = getLockManager();
  return locks
    ? locks.request(TOKEN_REFRESH_LOCK_NAME, { mode: 'exclusive' }, work)
    : withLocalStorageLease(work);
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

export const markSessionEnded = (error: unknown): void => {
  if (isSessionEnded()) return;

  sessionEnded = true;
  // #1113: a signed-out tab must not grant a grace retry on a later 401.
  lastRefreshCompletedAt = null;
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

/**
 * Read a refresh response body with its own ceiling (#1275). A timed-out
 * body rejects as AbortError so the caller treats it as a transport failure,
 * never an auth verdict (#565).
 */
const readResponseJsonWithTimeout = async (
  response: Response,
  timeoutMs: number,
): Promise<unknown> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      readResponseJson(response),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new DOMException('The refresh response body timed out.', 'AbortError')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
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

const requestTokenRefresh = async (
  refreshToken: string,
  signal?: AbortSignal,
): Promise<RefreshResult> => {
  try {
    const apiUrl = import.meta.env?.VITE_API_URL || '';
    const response = await fetchWithTimeout(
      `${apiUrl}/v1/auth/refresh`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
        signal,
      },
      TOKEN_REFRESH_REQUEST_TIMEOUT_MS,
    );

    if (!response.ok) {
      // Headers already gave the status, so a stuck body must not mask the
      // verdict: fall back to a null payload and let the status decide.
      const payload = await readResponseJsonWithTimeout(
        response,
        TOKEN_REFRESH_BODY_TIMEOUT_MS,
      ).catch(() => null);
      const error = getRefreshError(payload, response.status);
      logger.warn('Token refresh failed:', { status: response.status, error });
      if (isTerminalRefreshFailure(error)) throw error;
      throw new TokenRefreshTransientError(error.message, error.status, error.code);
    }

    const data = (await readResponseJsonWithTimeout(
      response,
      TOKEN_REFRESH_BODY_TIMEOUT_MS,
    )) as Record<string, unknown> | null;
    const responseError = getRefreshError(data, response.status);
    if (isTerminalRefreshFailure(responseError)) {
      logger.warn('Token refresh failed:', { status: response.status, error: responseError });
      throw responseError;
    }

    if (!data || typeof data.accessToken !== 'string' || typeof data.refreshToken !== 'string') {
      const error = new TokenRefreshError(
        'Token refresh returned an invalid payload',
        response.status,
      );
      logger.error('Token refresh returned an invalid payload:', { error });
      throw new TokenRefreshTransientError(error.message, error.status, error.code);
    }

    return {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    };
  } catch (error) {
    logger.error('Error refreshing token:', { error });
    // A blackholed endpoint is not an auth verdict — propagate it so callers
    // keep the stored session instead of signing the player out (#565).
    if (isTransportFailure(error)) throw new TokenRefreshTransportError();
    if (error instanceof TokenRefreshError) throw error;
    return null;
  }
};

/** Bound for waiting on late refresh work before ending a session (#1263). */
const LATE_REFRESH_WAIT_MS = 10_000;

/**
 * Remember a deadline-fired exchange's work so a later terminal failure can
 * wait for its late success instead of ending the session on a spent token.
 * Entries remove themselves when they settle; nothing here overwrites
 * another entry, so a second deadline never drops the first unawaited.
 * Adoption is still gated by the contender rule (the late handler checks
 * the stored token === the sent token, and the post-wait re-check uses
 * getSharedRefreshResult), so a stale pair from an older entry can never
 * overwrite a newer published pair.
 */
const registerPendingLateWork = (work: Promise<RefreshResult>): void => {
  pendingLateWork.add(work);
  const clear = (): void => {
    pendingLateWork.delete(work);
  };
  void work.then(clear, clear);
};

/** Wait for ALL registered late work, bounded, without failing on its outcome. */
const awaitPendingLateWork = async (): Promise<void> => {
  // Snapshot: refreshAccessToken single-flight serializes coordination, so
  // no second exchange can register during this wait in-tab; the snapshot
  // is the complete set this terminal path must await.
  const lateWork = [...pendingLateWork];
  // Without shared storage the re-check can never succeed; do not delay a
  // terminal failure waiting for work that cannot be adopted (headless host).
  if (lateWork.length === 0 || typeof window === 'undefined') return;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.allSettled(lateWork).then(() => undefined),
      new Promise<void>((resolve) => {
        timeoutId = setTimeout(resolve, LATE_REFRESH_WAIT_MS);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
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

    // The deadline race rejects while the exchange itself may still settle:
    // a slow response body can complete after the 20 s ceiling, and the
    // server rotates the refresh token on success. Keep the work promise in
    // a holder (a closure-assigned local narrows to never here) so a late
    // success can still be adopted below (#1263).
    const pendingWork: { current: Promise<RefreshResult> | null } = { current: null };
    try {
      const tokens = await withRefreshDeadline((signal) => {
        pendingWork.current = requestTokenRefresh(refreshToken, signal);
        return pendingWork.current;
      });
      if (tokens) {
        // Publish before releasing the cross-tab lock so the next tab adopts
        // these tokens instead of making a second exchange.
        persistSession({ access_token: tokens.accessToken, refresh_token: tokens.refreshToken });
      }
      return tokens;
    } catch (error) {
      const lateWork = pendingWork.current;
      if (error instanceof TokenRefreshTransportError && lateWork) {
        // Register the work before adopting it: a later refresh that fails
        // terminally on the spent token waits for this late success first.
        registerPendingLateWork(lateWork);
        // The deadline fired, but the exchange may still complete on the
        // server and rotate the refresh token. If it succeeds late, persist
        // its pair when the stored session still holds the token we sent —
        // dropping it would make the next refresh fail with invalid_grant.
        // A newer published pair (another tab won the race) is never
        // overwritten, and a late failure is already surfaced as transient.
        void lateWork
          .then((lateTokens) => {
            if (!lateTokens || isSessionEnded()) return;
            const stored = readSharedSession();
            if (stored?.refresh_token === refreshToken) {
              persistSession({
                access_token: lateTokens.accessToken,
                refresh_token: lateTokens.refreshToken,
              });
            }
          })
          .catch(() => {
            // Late failure: the caller already got the transient verdict.
          });
      }
      if (error instanceof TokenRefreshError && isTerminalRefreshFailure(error)) {
        // A contender may have spent the single-use refresh token just before
        // this tab. Adopt its newer pair instead of signing out the loser.
        const sharedTokens = getSharedRefreshResult(refreshToken, currentAccessToken);
        if (sharedTokens) {
          persistSession({
            access_token: sharedTokens.accessToken,
            refresh_token: sharedTokens.refreshToken,
          });
          return sharedTokens;
        }
        // A deadline-fired exchange from this tab may still be settling: its
        // late success rotates the token this refresh just spent. Wait for it
        // (bounded) and re-check storage before ending the session (#1263).
        await awaitPendingLateWork();
        const lateSharedTokens = getSharedRefreshResult(refreshToken, currentAccessToken);
        if (lateSharedTokens) {
          persistSession({
            access_token: lateSharedTokens.accessToken,
            refresh_token: lateSharedTokens.refreshToken,
          });
          return lateSharedTokens;
        }
      }
      throw error;
    }
  });
};

/** Epoch ms of the last refresh that produced a token pair in this tab (#1113). */
let lastRefreshCompletedAt: number | null = null;
export const getLastRefreshCompletedAt = (): number | null => lastRefreshCompletedAt;
/** Test seam: forget the last completed refresh so each test starts clean. */
export const resetLastRefreshCompletedAtForTests = (): void => {
  lastRefreshCompletedAt = null;
};

/** Serialize every refresh caller so rotating refresh tokens are never raced. */
export const refreshAccessToken = (
  refreshToken: string,
  currentAccessToken?: string,
): Promise<RefreshResult> => {
  if (isSessionEnded()) return Promise.resolve(null);

  if (!refreshInFlight) {
    const coordinatedRefresh = refreshWithCoordination(refreshToken, currentAccessToken)
      .then((result) => {
        // #1113: every refresh (timer, page load, 401 retry) passes through
        // here, so this is the one place that records a completed refresh.
        // Grace state is per tab: another tab's refresh does not open it here.
        if (result) lastRefreshCompletedAt = Date.now();
        return result;
      })
      .catch((error: unknown) => {
        // Transport failures propagate: they are not auth verdicts, so the
        // caller's stored session must stay intact (#565).
        if (error instanceof TokenRefreshTransportError) throw error;
        if (error instanceof TokenRefreshTransientError) throw error;
        if (error instanceof TokenRefreshError && isTerminalRefreshFailure(error)) {
          markSessionEnded(error);
          return null;
        }
        logger.error('Token refresh coordination failed:', { error });
        return null;
      });
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
    // #1249: the shared session JSON is the cross-tab source of truth. A
    // fresh tab has empty sessionStorage, so the split keys above yield no
    // refresh token even when the shared JSON holds one — and a tab that
    // missed a rotation (discarded/frozen, storage event never processed)
    // still holds the previous pair's refresh token in its sessionStorage.
    // Pairing that stale refresh token with the current access token would
    // poison the shared pair on the next persist. So when the shared JSON's
    // access token matches, its refresh token is authoritative — even when
    // absent, because a genuinely access-only pair must not resurrect a
    // stale refresh token. Only when the shared JSON is absent or belongs
    // to a different sign-in do the split keys stand (e.g. a shared-JSON
    // parse failure). A shared pair is never staler than the split keys:
    // every sessionStorage write ships with a shared-JSON write in the
    // same persistSession call, and shared JSON only changes via another
    // tab's persistSession, which makes it newer.
    const shared = readSharedSession();
    if (shared && shared.access_token === accessToken) {
      return {
        access_token: accessToken,
        refresh_token: shared.refresh_token,
      };
    }
    return {
      access_token: accessToken,
      refresh_token: refreshToken ?? undefined,
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

/**
 * Cross-tab adopt rule (#1249): never adopt an access-only session over a
 * current session that has a refresh token WHEN THE ACCESS TOKEN MATCHES.
 * A storage event carrying a same-access access-only pair means the writing
 * tab read partial state (a fresh tab, whose sessionStorage is empty);
 * adopting it would spread the drop into this tab's state and, through the
 * persistence effect, back into shared storage. But a DIFFERENT access
 * token is a genuinely new pair — a re-sign-in, including an access-only
 * one (CallbackPage and finishSignIn persist refresh only when present) —
 * and refusing it would strand this tab on the old session while its
 * refresh timer keeps rotating the old pair over the new sign-in.
 * Adoption re-arms that timer: the auto-refresh effect depends on
 * session?.access_token, so adopting a new access token clears the old
 * timer. A session with no access token is never adopted. Adoption of a
 * full pair, or adoption when the current session has no refresh token,
 * is unchanged.
 */
export const shouldAdoptSharedSession = (
  current: WorkOSSession | null,
  next: WorkOSSession,
): boolean => {
  if (!next.access_token) return false;
  if (!next.refresh_token && current?.refresh_token && next.access_token === current.access_token)
    return false;
  return true;
};

export const persistSession = (session: WorkOSSession | null): void => {
  if (typeof window === 'undefined') {
    headlessSession = session;
    if (session) clearSessionEnded();
    return;
  }
  if (session) {
    clearSessionEnded();
    // #1249: a tab must never overwrite a stored pair that has a refresh
    // token with one that has none. A fresh tab's loadCachedSession()
    // returns access-only (empty sessionStorage), and persisting it used
    // to destroy the shared refresh token for every tab. Preserve the
    // stored refresh token when the access token matches — the incoming
    // pair carries no newer information about the refresh token in that
    // case, and writing it into this tab's sessionStorage heals the tab.
    // A different access token means a genuinely new pair, so a stale
    // refresh token is never resurrected across pairs.
    const stored = readSharedSession();
    const refreshToken =
      session.refresh_token ??
      (stored && stored.access_token === session.access_token ? stored.refresh_token : undefined);
    const merged: WorkOSSession = {
      access_token: session.access_token,
      ...(refreshToken ? { refresh_token: refreshToken } : {}),
    };
    window.localStorage.setItem('workos_access_token', merged.access_token);
    if (merged.refresh_token) {
      // Keep refresh token scoped to browser session to reduce persistence risk.
      window.sessionStorage.setItem('workos_refresh_token', merged.refresh_token);
      window.localStorage.removeItem('workos_refresh_token');
    } else {
      window.sessionStorage.removeItem('workos_refresh_token');
      window.localStorage.removeItem('workos_refresh_token');
    }
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(merged));
  } else {
    window.localStorage.removeItem('workos_access_token');
    window.localStorage.removeItem('workos_refresh_token');
    window.sessionStorage.removeItem('workos_refresh_token');
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  }
};
