import { logServerRequestId } from './request-id-log';

import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  startRequestTimeout,
} from '@/infrastructure/api/fetch-with-timeout';
import { waitForAuth } from '@/lib/auth-gate';
import logger from '@/lib/logger';
import * as TokenService from '@/services/auth/TokenService';

function getTokenServiceExport<T>(name: string, fallback: T): T {
  try {
    const value = (TokenService as unknown as Record<string, unknown>)[name];
    return (value ?? fallback) as T;
  } catch {
    return fallback;
  }
}

const getAuthHeaders = getTokenServiceExport<typeof TokenService.getAuthHeaders>(
  'getAuthHeaders',
  () => ({}),
);
const loadCachedSession = getTokenServiceExport<typeof TokenService.loadCachedSession>(
  'loadCachedSession',
  () => null,
);
const persistSession = getTokenServiceExport<typeof TokenService.persistSession>(
  'persistSession',
  () => undefined,
);
const refreshAccessTokenOnce = getTokenServiceExport<typeof TokenService.refreshAccessTokenOnce>(
  'refreshAccessTokenOnce',
  async () => null,
);
const TokenRefreshTransportError = getTokenServiceExport<
  typeof TokenService.TokenRefreshTransportError
>(
  'TokenRefreshTransportError',
  class TokenRefreshTransportErrorFallback extends Error {
    constructor(message = 'Token refresh endpoint unreachable') {
      super(message);
      this.name = 'TokenRefreshTransportError';
    }
  },
);
const isTransientRefreshFailure = (error: unknown): boolean =>
  error instanceof TokenRefreshTransportError ||
  (error instanceof Error && error.name === 'TokenRefreshTransientError');
const safeLoadCachedSession = (): ReturnType<typeof loadCachedSession> => {
  try {
    return loadCachedSession();
  } catch {
    // Storage can be unavailable in embedded/test contexts; that is an
    // anonymous request, not a transport failure.
    return null;
  }
};
const markSessionEnded = (error: Error): void => {
  const mark = getTokenServiceExport<typeof TokenService.markSessionEnded | undefined>(
    'markSessionEnded',
    undefined,
  );
  mark?.(error);
};

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8888';
const LLM_GENERATE_ROUTE_PREFIX = '/v1/llm/generate';
const IMAGE_GENERATE_ROUTE_PREFIX = '/v1/images/generate';
const MEMORY_EXTRACTION_JOBS_ROUTE = '/v1/memory-extraction/jobs';
export const NETWORK_RETRY_BUDGET_MS = 20_000;
export const BACKGROUND_LLM_RETRY_BUDGET_MS = 5_000;
const NETWORK_RETRY_INITIAL_DELAY_MS = 1_000;
const NETWORK_RETRY_MAX_DELAY_MS = 8_000;
const TOKEN_REFRESH_MARGIN_MS = 2 * 60 * 1000;
/**
 * #1113: a 401 that lands shortly after a refresh finished is most likely a
 * request that was already in flight with the pre-rotation token. Retry once
 * with the stored (new) token instead of starting a second refresh, which would
 * rotate the refresh token again and race the first one.
 */
export const REFRESH_RETRY_GRACE_MS = 10 * 1000;
const getLastRefreshCompletedAt = getTokenServiceExport<
  typeof TokenService.getLastRefreshCompletedAt | undefined
>('getLastRefreshCompletedAt', undefined);

function isWithinRefreshGrace(): boolean {
  const completedAt = getLastRefreshCompletedAt?.() ?? null;
  return completedAt !== null && Date.now() - completedAt <= REFRESH_RETRY_GRACE_MS;
}

export type FetchWithAuthOptions = RequestInit & {
  retryBudgetMs?: number;
  timeoutMs?: number | null;
};

export interface MemoryExtractionJob {
  sessionId: string;
  characterId?: string;
  /** 'memories' parses a JSON list of memories; 'summary' stores the text as one summary row. */
  kind: 'memories' | 'summary';
  prompt: string;
  maxTokens?: number;
  turn?: number;
}

export type NetworkRetryListener = (isRetrying: boolean) => void;

const networkRetryListeners = new Set<NetworkRetryListener>();
let activeNetworkRetries = 0;

function notifyNetworkRetryListeners(): void {
  const isRetrying = activeNetworkRetries > 0;
  for (const listener of networkRetryListeners) {
    listener(isRetrying);
  }
}

export function subscribeToNetworkRetry(listener: NetworkRetryListener): () => void {
  networkRetryListeners.add(listener);
  listener(activeNetworkRetries > 0);
  return () => networkRetryListeners.delete(listener);
}
export const SESSION_EXPIRED_MESSAGE = 'Your sign-in expired — sign in again; your game is saved';

export type TurnPhase =
  | 'submit'
  | 'preflight'
  | 'generate start'
  | 'generate end'
  | 'text shown'
  | 'extract start'
  | 'extract end'
  | 'persist'
  | 'composer enabled';

export type TurnPhaseReporter = (phase: TurnPhase, requestId?: string | null) => void;

/** `ms` is the elapsed delta from the previous phase, not cumulative turn time. */
export function logTurnPhase(phase: TurnPhase, deltaMs: number, requestId: string | null): void {
  logger.info('TURN_PHASE', {
    phase,
    ms: Math.max(0, Math.round(deltaMs)),
    requestId,
  });
}

export function createTurnPhaseReporter(): TurnPhaseReporter {
  let previousAt = performance.now();
  let currentRequestId: string | null = null;

  return (phase, requestId) => {
    const now = performance.now();
    if (requestId) currentRequestId = requestId;
    logTurnPhase(phase, phase === 'submit' ? 0 : now - previousAt, currentRequestId);
    previousAt = now;
  };
}

function isGenerateRoute(path: string): boolean {
  return path.startsWith(LLM_GENERATE_ROUTE_PREFIX);
}

function getRouteTimeoutMs(path: string): number | undefined {
  // Memory extraction has no timeout: the server answers 202 at once and finishes the job
  // itself (#2148). The 10 s timeout that used to sit here aborted every production extraction
  // and logged each one as LLM_API_REQUEST_ABORTED.
  if (path.startsWith(MEMORY_EXTRACTION_JOBS_ROUTE)) return undefined;
  if (isGenerateRoute(path)) return 90_000;
  // Image generation is model work like /v1/llm/generate: slow but bounded by the
  // caller, not by the transport. Everything else gets a ceiling so a deploy
  // swap that blackholes a connection surfaces as an error instead of hanging
  // the UI forever (#565).
  if (path.startsWith(IMAGE_GENERATE_ROUTE_PREFIX)) return undefined;
  return DEFAULT_REQUEST_TIMEOUT_MS;
}

function getErrorName(error: unknown): string {
  if (error && typeof error === 'object' && 'name' in error) {
    const name = (error as { name?: unknown }).name;
    if (typeof name === 'string' && name) return name;
  }
  return error instanceof Error ? error.name : 'UnknownError';
}

function getErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return error instanceof Error ? error.message : String(error);
}

export function isNetworkError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let candidate: unknown = error;
  while (candidate && !seen.has(candidate)) {
    seen.add(candidate);
    const errorName = getErrorName(candidate);
    const errorMessage = getErrorMessage(candidate);
    if (
      errorName === 'TypeError' &&
      /failed to fetch|network(?:error| error)|load failed/i.test(errorMessage)
    ) {
      return true;
    }
    candidate =
      typeof candidate === 'object' && candidate !== null && 'cause' in candidate
        ? (candidate as { cause?: unknown }).cause
        : undefined;
  }
  return false;
}

function waitForNetworkRetry(delayMs: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timerId);
      signal?.removeEventListener('abort', onAbort);
      reject(new DOMException('The request was aborted.', 'AbortError'));
    };

    const timerId = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);

    if (signal) {
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }
  });
}

async function requestWithNetworkRetry(
  path: string,
  request: () => Promise<Response>,
  signal?: AbortSignal | null,
  retryBudgetMs: number = NETWORK_RETRY_BUDGET_MS,
): Promise<Response> {
  const startedAt = Date.now();
  let delayMs = NETWORK_RETRY_INITIAL_DELAY_MS;
  let isRetrying = false;
  let attempt = 0;

  try {
    while (true) {
      try {
        return await request();
      } catch (error) {
        if (!isNetworkError(error)) throw error;

        const elapsedMs = Date.now() - startedAt;
        const remainingMs = retryBudgetMs - elapsedMs;
        if (remainingMs <= 0) throw error;

        const retryDelayMs = Math.min(delayMs, remainingMs);
        if (!isRetrying) {
          isRetrying = true;
          activeNetworkRetries += 1;
          notifyNetworkRetryListeners();
        }
        attempt += 1;
        logger.warn('API_NETWORK_RETRY', {
          route: path,
          attempt,
          delayMs: retryDelayMs,
          elapsedMs,
        });
        await waitForNetworkRetry(retryDelayMs, signal);
        delayMs = Math.min(delayMs * 2, NETWORK_RETRY_MAX_DELAY_MS);
      }
    }
  } finally {
    if (isRetrying) {
      activeNetworkRetries = Math.max(0, activeNetworkRetries - 1);
      notifyNetworkRetryListeners();
    }
  }
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor(message: string, status: number, retryable: boolean, retryAfterMs?: number) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

/** `/v1/llm/generate` answered 402: the plan's daily AI budget is spent until `resetAt`. */
export class QuotaExceededError extends ApiClientError {
  readonly resetAt?: string;

  constructor(message: string, resetAt?: string, retryAfterMs?: number) {
    super(message, 402, false, retryAfterMs);
    this.name = 'QuotaExceededError';
    this.resetAt = resetAt;
  }
}

export class SessionExpiredError extends ApiClientError {
  constructor() {
    super(SESSION_EXPIRED_MESSAGE, 401, false);
    this.name = 'SessionExpiredError';
  }
}

/**
 * #2456: the server reports that the party was defeated in a concluded
 * encounter. This is a handled terminal game state, not a transport or
 * provider failure — callers must surface the death screen instead of the
 * generic error path.
 */
export class PartyDefeatedError extends Error {
  readonly encounterId: string | null;

  constructor(encounterId?: string | null) {
    super('Party defeated — terminal game state');
    this.name = 'PartyDefeatedError';
    this.encounterId = encounterId ?? null;
  }
}

function isV1Route(path: string): boolean {
  return path.startsWith('/v1/') || path.startsWith('/api/trpc/');
}

function buildRequestInit(options: RequestInit, accessToken?: string): RequestInit {
  return {
    ...options,
    headers: {
      ...getAuthHeaders(),
      ...options.headers,
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  };
}

function getAccessTokenExpiry(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const paddedPayload = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '=');
    const expiry = Number((JSON.parse(atob(paddedPayload)) as { exp?: unknown }).exp);
    return Number.isFinite(expiry) && expiry > 0 ? expiry * 1000 : null;
  } catch {
    return null;
  }
}

function isAccessTokenExpiringSoon(token: string): boolean {
  const expiry = getAccessTokenExpiry(token);
  return expiry !== null && Date.now() >= expiry - TOKEN_REFRESH_MARGIN_MS;
}

async function refreshExpiringSession(): Promise<string | undefined> {
  const session = safeLoadCachedSession();
  if (!session?.refresh_token || !isAccessTokenExpiringSoon(session.access_token)) return undefined;

  let tokens: Awaited<ReturnType<typeof refreshAccessTokenOnce>>;
  try {
    tokens = await refreshAccessTokenOnce(session.refresh_token, session.access_token);
  } catch (error) {
    if (isTransientRefreshFailure(error)) throw error;
    const expired = new SessionExpiredError();
    markSessionEnded(expired);
    throw expired;
  }
  if (!tokens) {
    const expired = new SessionExpiredError();
    markSessionEnded(expired);
    throw expired;
  }

  persistSession({ access_token: tokens.accessToken, refresh_token: tokens.refreshToken });
  return tokens.accessToken;
}

/**
 * Fetch an API route and recover one expired access token before surfacing the
 * session-expired state. Callers retain ownership of non-2xx response parsing.
 */
export async function fetchWithAuth(
  path: string,
  options: FetchWithAuthOptions = {},
): Promise<Response> {
  const {
    retryBudgetMs = NETWORK_RETRY_BUDGET_MS,
    timeoutMs: requestedTimeoutMs,
    ...requestInit
  } = options;
  // #565: bound the whole attempt so a blackholed connection (deploy swap)
  // fails instead of hanging the caller forever. Exempt routes (model work,
  // memory extraction) keep no ceiling — see getRouteTimeoutMs.
  const timeoutMs =
    requestedTimeoutMs === null ? undefined : (requestedTimeoutMs ?? getRouteTimeoutMs(path));
  const noTimeoutSignal = requestedTimeoutMs === null ? new AbortController().signal : undefined;
  const timeoutHandle =
    timeoutMs === undefined ? undefined : startRequestTimeout(timeoutMs, requestInit.signal);
  // The timeout signal replaces the caller's signal on the wire: it fires on
  // timeout AND when the caller's signal aborts (see startRequestTimeout).
  const timeoutSignal = timeoutHandle?.signal ?? requestInit.signal ?? noTimeoutSignal;
  const effectiveInit = timeoutSignal ? { ...requestInit, signal: timeoutSignal } : requestInit;
  const timeoutPromise = timeoutHandle
    ? (() => {
        const handle = timeoutHandle;
        return new Promise<never>((_, reject) => {
          const rejectOnAbort = (): void =>
            reject(new DOMException('The request was aborted.', 'AbortError'));
          if (handle.signal.aborted) {
            rejectOnAbort();
          } else {
            handle.signal.addEventListener('abort', rejectOnAbort, { once: true });
          }
        });
      })()
    : null;
  const request = (accessToken?: string): Promise<Response> =>
    (timeoutPromise
      ? Promise.race([
          requestWithNetworkRetry(
            path,
            () => fetch(`${API_BASE_URL}${path}`, buildRequestInit(effectiveInit, accessToken)),
            timeoutSignal,
            retryBudgetMs,
          ),
          timeoutPromise,
        ])
      : requestWithNetworkRetry(
          path,
          () => fetch(`${API_BASE_URL}${path}`, buildRequestInit(effectiveInit, accessToken)),
          timeoutSignal,
          retryBudgetMs,
        )) as Promise<Response>;

  try {
    // A backgrounded tab can miss the periodic AuthContext timer. Refresh
    // before the request when its access token is inside the two-minute window.
    const preflightSession = safeLoadCachedSession();
    const refreshedAccessToken =
      preflightSession?.refresh_token && isAccessTokenExpiringSoon(preflightSession.access_token)
        ? await refreshExpiringSession()
        : undefined;
    const response = await request(refreshedAccessToken);
    if (response.status !== 401 || !isV1Route(path)) return response;

    const session = safeLoadCachedSession();
    // #1113: take the grace path only when the failed request carried an older
    // token than the stored one, i.e. it was already in flight when a refresh
    // finished. If it carried the current token (or we cannot tell which token
    // it sent), the 401 is a real auth failure and falls through to refresh.
    const sentAccessToken = refreshedAccessToken ?? preflightSession?.access_token;
    if (
      isWithinRefreshGrace() &&
      session?.access_token &&
      sentAccessToken &&
      session.access_token !== sentAccessToken
    ) {
      // #1113: a refresh just finished. Retry once with the stored token and
      // do not refresh again.
      logger.info('AUTH_RETRY_AFTER_401', { route: path, outcome: 'grace_retry' });
      const graceResponse = await request(session.access_token);
      if (graceResponse.status === 401) {
        logger.warn('AUTH_RETRY_AFTER_401', { route: path, outcome: 'session_expired' });
        markSessionEnded(new SessionExpiredError());
        throw new SessionExpiredError();
      }
      return graceResponse;
    }
    if (!session?.refresh_token) {
      logger.warn('AUTH_RETRY_AFTER_401', { route: path, outcome: 'refresh_unavailable' });
      markSessionEnded(new SessionExpiredError());
      throw new SessionExpiredError();
    }

    let tokens: Awaited<ReturnType<typeof refreshAccessTokenOnce>>;
    try {
      tokens = await refreshAccessTokenOnce(session.refresh_token, session.access_token);
    } catch (error) {
      // A transport failure reaching the refresh endpoint is not an auth
      // verdict — let it surface as-is instead of reporting session-expired
      // (#565). The stored session stays intact.
      if (isTransientRefreshFailure(error)) throw error;
      logger.warn('AUTH_RETRY_AFTER_401', { route: path, outcome: 'refresh_failed' });
      throw new SessionExpiredError();
    }
    if (!tokens) {
      logger.warn('AUTH_RETRY_AFTER_401', { route: path, outcome: 'refresh_failed' });
      markSessionEnded(new SessionExpiredError());
      throw new SessionExpiredError();
    }

    // A competing tab may have published a newer pair while this refresh was
    // in flight. Retry with that winner rather than replaying a rotated token.
    const storedSession = safeLoadCachedSession();
    const retryAccessToken =
      storedSession && storedSession.access_token !== session.access_token
        ? storedSession.access_token
        : tokens.accessToken;
    const retryRefreshToken =
      storedSession && storedSession.access_token !== session.access_token
        ? storedSession.refresh_token || tokens.refreshToken
        : tokens.refreshToken;
    persistSession({ access_token: retryAccessToken, refresh_token: retryRefreshToken });
    const retryResponse = await request(retryAccessToken);
    if (retryResponse.status === 401) {
      logger.warn('AUTH_RETRY_AFTER_401', { route: path, outcome: 'session_expired' });
      markSessionEnded(new SessionExpiredError());
      throw new SessionExpiredError();
    }

    logger.info('AUTH_RETRY_AFTER_401', {
      route: path,
      outcome: retryResponse.ok ? 'retry_succeeded' : 'retry_failed',
    });
    return retryResponse;
  } finally {
    timeoutHandle?.done();
  }
}

/**
 * tRPC and other clients hand the transport a fully resolved URL. Keep those
 * calls on the same refresh/retry seam by reducing the URL to its API path.
 */
export function fetchWithAuthUrl(
  input: RequestInfo | URL,
  options: FetchWithAuthOptions = {},
): Promise<Response> {
  const inputUrl = typeof input === 'string' || input instanceof URL ? input.toString() : input.url;
  const parsed = new URL(inputUrl, API_BASE_URL);
  return fetchWithAuth(`${parsed.pathname}${parsed.search}`, options);
}

export interface LLMHistoryMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface GenerateTextParams {
  prompt: string;
  /**
   * #352: the stable system block, sent as the `system` message so the
   * provider can cache on the prompt prefix. Omitted on the opening turn and
   * by non-DM generations.
   */
  systemPrompt?: string;
  /** The player's raw turn input, kept separate from the assembled prompt for server-side intent detection. */
  player_input?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  history?: LLMHistoryMessage[];
  provider?: 'openrouter' | 'gemini';
  responseSchema?: Record<string, unknown>;
  /** Aborts the request; the caller treats the resulting AbortError as a cancel. */
  signal?: AbortSignal;
  /**
   * #633 PR2: progressive DM narration. When set, the request sends
   * `stream: true` and the server replies `text/event-stream`: this callback
   * fires once per narration chunk, in order, as tokens arrive. The returned
   * string is still the authoritative final text. When the response is not an
   * SSE stream (older server, fallback), the callback never fires and the
   * call behaves exactly like the non-streaming path.
   */
  onStream?: (chunk: string) => void;
  /** #633: the server discarded the streamed attempt (retry or failover); clear the preview. */
  onStreamReset?: () => void;
  requestType?: 'user' | 'system';
  onResponseMetadata?: (metadata: {
    provider?: 'openrouter' | 'gemini';
    model?: string;
    dmReplyMessageId?: string;
  }) => void;
  /**
   * Optional, numbers-only per-section prompt token telemetry (log-only on the
   * server -- see #1688). No prompt content, just counts. Omitted entirely if
   * the caller didn't compute it or computation failed.
   */
  metrics?: Record<string, number>;
  /**
   * #1907 PR1: session + player context for server-side combat entry detection. When present,
   * the returned envelope may carry `combat_entry_pending`; the explicit `/combat/sessions/:id/enter`
   * request owns seating and initiative.
   */
  /** #2050 C: correlates the server's envelope log line on every generate. */
  sessionId?: string;
  /**
   * #849: the token the tactical-context GET handed out with its one-shot
   * facts. Echoing it on the generate confirms delivery; the server deletes
   * the batch only on this echo (or when its TTL lapses).
   */
  tacticalDeliveryToken?: string;
  /**
   * #2218: the id reserved for this turn's DM row. The server persists a display-ready reply
   * under it before responding, and the client's own save of the turn replaces that row in
   * place. Only the main DM turn sends it.
   */
  dmReply?: {
    messageId: string;
    inCombat?: boolean;
    narrationGated?: boolean;
    holdProse?: boolean;
    rollRequestId?: string;
  };
  combatEntry?: {
    sessionId: string;
    player: {
      characterId: string | null;
      name: string;
      initiativeModifier: number;
      hpCurrent?: number;
      hpMax?: number;
    };
  };
}

/**
 * #633 PR2: the final payload of the opt-in SSE stream — the same shape as
 * the POST /v1/llm/generate JSON response.
 */
export interface GenerateStreamPayload {
  text?: string;
  provider?: 'openrouter' | 'gemini';
  model?: string;
  dmReplyMessageId?: string;
  terminalState?: string;
  encounterId?: string;
  error?: string;
  resetAt?: string;
}

export interface GenerateImageParams {
  prompt: string;
  model?: string;
  referenceImage?: string; // deprecated single-image form
  referenceImages?: string[];
  /** Game session the image belongs to; absent for portraits and campaign covers (#2269). */
  sessionId?: string;
}

export interface AppendMessageImageParams {
  messageId: string;
  image: { url: string; prompt?: string; model?: string };
}

export interface ImageQuotaStatus {
  plan: string;
  limits: { daily: { llm: number; image: number; voice: number } };
  usage: number;
  remaining: number;
  resetAt: string;
}

interface LlmApiErrorBody {
  error?: string;
  message?: string;
  retryable?: boolean;
  retry_after?: number;
  resetAt?: string;
}

class LlmApiClient {
  /**
   * Server request id of the most recent call through `fetchWithAuth`, so a
   * caller that throws after a successful response can still name it. Read it
   * immediately in the failing path; it is last-write-wins across concurrent
   * calls and is for diagnosis only. (#2050 D)
   */
  lastRequestId: string | null = null;
  lastGenerateRequestId: string | null = null;
  private useOfflineFallback = false;
  private offlineFallbackSetAt = 0;
  private static readonly OFFLINE_RESET_MS = 30_000;

  private async fetchWithAuth(path: string, options: FetchWithAuthOptions = {}): Promise<Response> {
    if (
      this.useOfflineFallback &&
      Date.now() - this.offlineFallbackSetAt >= LlmApiClient.OFFLINE_RESET_MS
    ) {
      this.useOfflineFallback = false;
    }

    if (this.useOfflineFallback && !isGenerateRoute(path)) {
      const msRemaining = Math.max(
        0,
        LlmApiClient.OFFLINE_RESET_MS - (Date.now() - this.offlineFallbackSetAt),
      );
      logger.warn('OFFLINE_FALLBACK_BLOCKED', { route: path, msRemaining });
      throw new Error('API unavailable');
    }

    await waitForAuth();

    try {
      const startedAt = performance.now();
      // Route timeouts (e.g. 90 s for /v1/llm/generate, 30 s default) are
      // applied inside the shared fetchWithAuth (#565).
      const res = await fetchWithAuth(path, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });
      // Kept so a caller that throws AFTER a 200 can still name the server
      // request it was processing -- the #2049 attempt-1 shape. (#2050 D)
      this.lastRequestId = logServerRequestId(path, res, performance.now() - startedAt);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        let body: LlmApiErrorBody | null = null;
        try {
          body = text ? (JSON.parse(text) as LlmApiErrorBody) : null;
        } catch {
          body = null;
        }
        const retryable = body?.retryable ?? (res.status === 429 || res.status >= 500);
        const message = body?.error || body?.message || text || res.statusText;
        const headerRetryAfter = Number(res.headers?.get('retry-after'));
        const retryAfterSeconds =
          body?.retry_after ?? (Number.isFinite(headerRetryAfter) ? headerRetryAfter : undefined);
        const retryAfterMs =
          retryAfterSeconds && retryAfterSeconds > 0
            ? Math.ceil(retryAfterSeconds * 1000)
            : undefined;
        if (res.status === 402 && isGenerateRoute(path)) {
          throw new QuotaExceededError(
            `API ${res.status}: ${message}`,
            typeof body?.resetAt === 'string' ? body.resetAt : undefined,
            retryAfterMs,
          );
        }
        throw new ApiClientError(
          `API ${res.status}: ${message}`,
          res.status,
          retryable,
          retryAfterMs,
        );
      }
      return res;
    } catch (err: unknown) {
      const errorName = getErrorName(err);
      const errorMessage = getErrorMessage(err);
      if (errorName === 'AbortError') {
        logger.warn('LLM_API_REQUEST_ABORTED', {
          route: path,
          errorName,
          errorMessage,
          ...(this.lastRequestId ? { requestId: this.lastRequestId } : {}),
        });
      } else if (
        errorName === 'TypeError' &&
        /fetch/i.test(errorMessage) &&
        isGenerateRoute(path)
      ) {
        this.useOfflineFallback = true;
        this.offlineFallbackSetAt = Date.now();
        logger.warn('OFFLINE_FALLBACK_TRIPPED', {
          route: path,
          errorName,
          errorMessage,
          ...(this.lastRequestId ? { requestId: this.lastRequestId } : {}),
        });
      }
      throw err;
    }
  }

  /**
   * #633 PR2: consume the opt-in SSE stream from POST /v1/llm/generate.
   * `delta` events carry narration chunks in order; the `done` event carries
   * the final payload (the same shape as the JSON response). Returns null
   * when the response is not an SSE stream, so the caller falls back to the
   * JSON path. Throws on `error` events and on a stream that ends without a
   * final payload, mirroring the HTTP error mapping below.
   */
  private async readGenerateStream(
    res: Response,
    onStream: (chunk: string) => void,
    onStreamReset?: () => void,
  ): Promise<GenerateStreamPayload | null> {
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('text/event-stream') || !res.body) return null;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let payload: GenerateStreamPayload | null = null;
    const handleEvent = (data: string): void => {
      let event: {
        type?: string;
        text?: string;
        payload?: GenerateStreamPayload;
        message?: string;
        statusCode?: number;
      };
      try {
        event = JSON.parse(data) as typeof event;
      } catch {
        return;
      }
      if (event.type === 'delta' && typeof event.text === 'string') {
        onStream(event.text);
      } else if (event.type === 'reset') {
        onStreamReset?.();
      } else if (event.type === 'done' && event.payload && typeof event.payload === 'object') {
        payload = event.payload;
      } else if (event.type === 'error') {
        const status = typeof event.statusCode === 'number' ? event.statusCode : 500;
        throw new ApiClientError(
          `API ${status}: ${event.message ?? 'stream failed'}`,
          status,
          status === 429 || status >= 500,
        );
      }
    };
    const handleBlock = (block: string): void => {
      for (const line of block.split('\n')) {
        const match = /^data:\s?(.*?)\r?$/.exec(line);
        if (match) handleEvent(match[1]);
      }
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) >= 0) {
        handleBlock(buffer.slice(0, sep));
        buffer = buffer.slice(sep + 2);
      }
    }
    // Flush any buffered partial character, then a trailing event without a
    // terminating blank line (defensive).
    buffer += decoder.decode();
    if (buffer.length > 0) handleBlock(buffer);
    if (!payload) {
      throw new ApiClientError('API 500: stream ended without a final payload', 500, false);
    }
    return payload;
  }

  async generateText(params: GenerateTextParams): Promise<string> {
    this.lastGenerateRequestId = null;
    const preferredProvider =
      params.provider ||
      (import.meta.env.VITE_LLM_PROVIDER as 'openrouter' | 'gemini' | undefined) ||
      'openrouter';

    const makeReq = async (provider: 'openrouter' | 'gemini', model?: string) =>
      this.fetchWithAuth('/v1/llm/generate', {
        method: 'POST',
        retryBudgetMs: BACKGROUND_LLM_RETRY_BUDGET_MS,
        ...(params.signal ? { signal: params.signal } : {}),
        body: JSON.stringify({
          prompt: params.prompt,
          // #352: the stable system block; the server prepends it as the
          // `system` message before history and the user prompt.
          ...(params.systemPrompt ? { systemPrompt: params.systemPrompt } : {}),
          player_input: params.player_input,
          model: model || params.model,
          maxTokens: params.maxTokens,
          temperature: params.temperature,
          history: params.history,
          provider,
          responseSchema: params.responseSchema,
          requestType: params.requestType || 'user',
          metrics: params.metrics,
          sessionId: params.sessionId,
          combatEntry: params.combatEntry,
          dmReply: params.dmReply,
          tacticalDeliveryToken: params.tacticalDeliveryToken,
          // #633 PR2: opt-in to server-sent narration deltas. Off by default.
          ...(params.onStream ? { stream: true } : {}),
        }),
      });

    try {
      const res = await makeReq(preferredProvider);
      // #633 PR2: when the caller passed onStream, the server answers
      // text/event-stream. Anything else falls through to the JSON path.
      if (params.onStream) {
        const streamed = await this.readGenerateStream(res, params.onStream, params.onStreamReset);
        if (streamed) {
          // #2456: the party was defeated. This is a handled terminal state,
          // not a DM reply — throw so callers can render the death screen
          // instead of treating it as ordinary text or an error.
          if (streamed.terminalState === 'party_defeated') {
            throw new PartyDefeatedError(
              typeof streamed.encounterId === 'string' ? streamed.encounterId : null,
            );
          }
          if (typeof streamed.error === 'string') {
            // Mirror the 402 mapping: only the quota path returns resetAt.
            if (typeof streamed.resetAt === 'string') {
              throw new QuotaExceededError(`API 402: ${streamed.error}`, streamed.resetAt);
            }
            throw new ApiClientError(`API error: ${streamed.error}`, 500, false);
          }
          params.onResponseMetadata?.({
            provider: streamed.provider,
            model: streamed.model,
            ...(streamed.dmReplyMessageId ? { dmReplyMessageId: streamed.dmReplyMessageId } : {}),
          });
          this.lastGenerateRequestId = this.lastRequestId;
          return streamed.text ?? '';
        }
      }
      const data = (await res.json()) as {
        text?: string;
        provider?: 'openrouter' | 'gemini';
        model?: string;
        dmReplyMessageId?: string;
        terminalState?: string;
        encounterId?: string;
      };
      // #2456: the party was defeated. This is a handled terminal state, not a
      // DM reply — throw so callers can render the death screen instead of
      // treating it as ordinary text or an error.
      if (data?.terminalState === 'party_defeated') {
        throw new PartyDefeatedError(
          typeof data.encounterId === 'string' ? data.encounterId : null,
        );
      }
      params.onResponseMetadata?.({
        provider: data.provider,
        model: data.model,
        ...(data.dmReplyMessageId ? { dmReplyMessageId: data.dmReplyMessageId } : {}),
      });
      this.lastGenerateRequestId = this.lastRequestId;
      return data?.text ?? '';
    } catch (err: any) {
      const msg = String(err?.message || '');
      const isConfigErr = /Server not configured for OpenRouter/i.test(msg);
      const isGeminiConfigErr = /Server not configured for Gemini/i.test(msg);
      const retryableProviderFailure = err instanceof ApiClientError && err.retryable;

      if (preferredProvider === 'openrouter' && (isConfigErr || retryableProviderFailure)) {
        const res = await makeReq('gemini');
        const data = (await res.json()) as {
          text?: string;
          provider?: 'openrouter' | 'gemini';
          model?: string;
          terminalState?: string;
          encounterId?: string;
        };
        // #261 CB-027: the fallback provider's envelope can carry the handled terminal
        // state too; dropping it here turned a defeat into empty text.
        if (data?.terminalState === 'party_defeated') {
          throw new PartyDefeatedError(
            typeof data.encounterId === 'string' ? data.encounterId : null,
          );
        }
        params.onResponseMetadata?.({ provider: data.provider, model: data.model });
        this.lastGenerateRequestId = this.lastRequestId;
        return data?.text ?? '';
      }
      if (preferredProvider === 'gemini' && (isGeminiConfigErr || retryableProviderFailure)) {
        const res = await makeReq('openrouter');
        const data = (await res.json()) as {
          text?: string;
          provider?: 'openrouter' | 'gemini';
          model?: string;
          terminalState?: string;
          encounterId?: string;
        };
        // #261 CB-027: same handled terminal state on the other fallback direction.
        if (data?.terminalState === 'party_defeated') {
          throw new PartyDefeatedError(
            typeof data.encounterId === 'string' ? data.encounterId : null,
          );
        }
        params.onResponseMetadata?.({ provider: data.provider, model: data.model });
        this.lastGenerateRequestId = this.lastRequestId;
        return data?.text ?? '';
      }
      throw err;
    }
  }

  async generateImage(params: GenerateImageParams): Promise<string> {
    const res = await this.fetchWithAuth('/v1/images/generate', {
      method: 'POST',
      body: JSON.stringify({
        prompt: params.prompt,
        model: params.model,
        referenceImages:
          params.referenceImages || (params.referenceImage ? [params.referenceImage] : undefined),
        sessionId: params.sessionId,
      }),
    });
    const data = await res.json();
    return data?.image ?? '';
  }

  async appendMessageImage(params: AppendMessageImageParams): Promise<void> {
    const maxAttempts = 5;
    let lastError: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const res = await this.fetchWithAuth(
          `/v1/images/message/${encodeURIComponent(params.messageId)}/images`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              url: params.image.url,
              prompt: params.image.prompt,
              model: params.image.model,
            }),
          },
        );
        await res.json().catch(() => ({}));
        return;
      } catch (error) {
        lastError = error;
        const isNotFound = /API 404\b/.test(String((error as Error)?.message || error));
        if (!isNotFound || attempt === maxAttempts - 1) throw error;
        await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** attempt));
      }
    }
    throw lastError;
  }

  async getImageQuotaStatus(): Promise<ImageQuotaStatus | null> {
    try {
      const res = await this.fetchWithAuth('/v1/images/quota');
      return await res.json();
    } catch {
      return null;
    }
  }

  /**
   * Hand a memory extraction to the server and return without waiting for it (#2148).
   *
   * The server replies 202 as soon as it has accepted the job, then calls the model and writes
   * the memories itself; they reach the next turn from the DB like every other memory. Nothing
   * comes back to parse here. The only retry is the 5 s background network budget (#2137), and
   * this never rejects — a lost extraction must never surface in the turn.
   */
  async submitMemoryExtraction(
    job: MemoryExtractionJob,
    onTurnPhase?: TurnPhaseReporter,
  ): Promise<void> {
    onTurnPhase?.('extract start');
    try {
      await this.fetchWithAuth(MEMORY_EXTRACTION_JOBS_ROUTE, {
        method: 'POST',
        retryBudgetMs: BACKGROUND_LLM_RETRY_BUDGET_MS,
        body: JSON.stringify({
          session_id: job.sessionId,
          ...(job.characterId ? { character_id: job.characterId } : {}),
          kind: job.kind,
          prompt: job.prompt,
          ...(job.maxTokens ? { max_tokens: job.maxTokens } : {}),
          ...(job.turn !== undefined ? { turn: job.turn } : {}),
        }),
      });
    } catch (error) {
      logger.warn('[LLMApiClient] Memory extraction was not accepted', error);
    } finally {
      onTurnPhase?.('extract end');
    }
  }
}

export const llmApiClient = new LlmApiClient();
