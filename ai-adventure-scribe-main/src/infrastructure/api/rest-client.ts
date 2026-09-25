import { logServerRequestId } from './request-id-log';

import { waitForAuth } from '@/lib/auth-gate';
import logger from '@/lib/logger';
import {
  getAuthHeaders,
  loadCachedSession,
  persistSession,
  refreshAccessTokenOnce,
} from '@/services/auth/TokenService';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8888';
const LLM_GENERATE_ROUTE_PREFIX = '/v1/llm/generate';
const MEMORY_EXTRACTION_JOBS_ROUTE = '/v1/memory-extraction/jobs';
export const NETWORK_RETRY_BUDGET_MS = 20_000;
export const BACKGROUND_LLM_RETRY_BUDGET_MS = 5_000;
const NETWORK_RETRY_INITIAL_DELAY_MS = 1_000;
const NETWORK_RETRY_MAX_DELAY_MS = 8_000;

export type FetchWithAuthOptions = RequestInit & { retryBudgetMs?: number };

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
export const SESSION_EXPIRED_MESSAGE = 'Session expired — sign in again';

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
  if (isGenerateRoute(path)) return 60_000;
  return undefined;
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
  const errorName = getErrorName(error);
  const errorMessage = getErrorMessage(error);
  return (
    errorName === 'TypeError' &&
    /failed to fetch|network(?:error| error)|load failed/i.test(errorMessage)
  );
}

function waitForNetworkRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
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
  signal?: AbortSignal,
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

export class SessionExpiredError extends ApiClientError {
  constructor() {
    super(SESSION_EXPIRED_MESSAGE, 401, false);
    this.name = 'SessionExpiredError';
  }
}

function isV1Route(path: string): boolean {
  return path.startsWith('/v1/');
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

/**
 * Fetch an API route and recover one expired access token before surfacing the
 * session-expired state. Callers retain ownership of non-2xx response parsing.
 */
export async function fetchWithAuth(
  path: string,
  options: FetchWithAuthOptions = {},
): Promise<Response> {
  const { retryBudgetMs = NETWORK_RETRY_BUDGET_MS, ...requestInit } = options;
  const request = (accessToken?: string): Promise<Response> =>
    requestWithNetworkRetry(
      path,
      () => fetch(`${API_BASE_URL}${path}`, buildRequestInit(requestInit, accessToken)),
      requestInit.signal,
      retryBudgetMs,
    );

  const response = await request();
  if (response.status !== 401 || !isV1Route(path)) return response;

  const session = loadCachedSession();
  if (!session?.refresh_token) {
    logger.warn('AUTH_RETRY_AFTER_401', { route: path, outcome: 'refresh_unavailable' });
    throw new SessionExpiredError();
  }

  let tokens: Awaited<ReturnType<typeof refreshAccessTokenOnce>>;
  try {
    tokens = await refreshAccessTokenOnce(session.refresh_token, session.access_token);
  } catch {
    logger.warn('AUTH_RETRY_AFTER_401', { route: path, outcome: 'refresh_failed' });
    throw new SessionExpiredError();
  }

  if (!tokens) {
    logger.warn('AUTH_RETRY_AFTER_401', { route: path, outcome: 'refresh_failed' });
    throw new SessionExpiredError();
  }

  persistSession({ access_token: tokens.accessToken, refresh_token: tokens.refreshToken });
  const retryResponse = await request(tokens.accessToken);
  if (retryResponse.status === 401) {
    logger.warn('AUTH_RETRY_AFTER_401', { route: path, outcome: 'session_expired' });
    throw new SessionExpiredError();
  }

  logger.info('AUTH_RETRY_AFTER_401', {
    route: path,
    outcome: retryResponse.ok ? 'retry_succeeded' : 'retry_failed',
  });
  return retryResponse;
}

export interface LLMHistoryMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface GenerateTextParams {
  prompt: string;
  /** The player's raw turn input, kept separate from the assembled prompt for server-side intent detection. */
  player_input?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  history?: LLMHistoryMessage[];
  provider?: 'openrouter' | 'gemini';
  responseSchema?: Record<string, unknown>;
  onStream?: (chunk: string) => void;
  requestType?: 'user' | 'system';
  onResponseMetadata?: (metadata: { provider?: 'openrouter' | 'gemini'; model?: string }) => void;
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
   * #2218: the id reserved for this turn's DM row. The server persists a display-ready reply
   * under it before responding, and the client's own save of the turn replaces that row in
   * place. Only the main DM turn sends it.
   */
  dmReply?: { messageId: string; inCombat?: boolean };
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

export interface GenerateImageParams {
  prompt: string;
  model?: string;
  referenceImage?: string; // deprecated single-image form
  referenceImages?: string[];
  quality?: 'low' | 'medium' | 'high';
}

export interface AppendMessageImageParams {
  messageId: string;
  image: { url: string; prompt?: string; model?: string; quality?: 'low' | 'medium' | 'high' };
}

export interface ImageQuotaStatus {
  plan: string;
  limits: { daily: { llm: number; image: number; voice: number } };
  usage: number;
  remaining: number;
  resetAt: string;
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
    const timeoutMs = getRouteTimeoutMs(path);
    const timeoutController = timeoutMs === undefined ? undefined : new AbortController();
    let removeExternalAbortListener: (() => void) | undefined;
    if (timeoutController && options.signal) {
      const abortFromExternalSignal = (): void => timeoutController.abort();
      if (options.signal.aborted) {
        abortFromExternalSignal();
      } else {
        options.signal.addEventListener('abort', abortFromExternalSignal, { once: true });
        removeExternalAbortListener = () =>
          options.signal?.removeEventListener('abort', abortFromExternalSignal);
      }
    }
    const timeoutId = timeoutController
      ? setTimeout(() => timeoutController.abort(), timeoutMs)
      : undefined;

    try {
      const startedAt = performance.now();
      const res = await fetchWithAuth(path, {
        ...options,
        ...(timeoutController ? { signal: timeoutController.signal } : {}),
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
        let body: {
          error?: string;
          message?: string;
          retryable?: boolean;
          retry_after?: number;
        } | null = null;
        try {
          body = text ? (JSON.parse(text) as typeof body) : null;
        } catch {
          body = null;
        }
        const retryable = body?.retryable ?? (res.status === 429 || res.status >= 500);
        const message = body?.error || body?.message || text || res.statusText;
        const headerRetryAfter = Number(res.headers?.get('retry-after'));
        const retryAfterSeconds =
          body?.retry_after ?? (Number.isFinite(headerRetryAfter) ? headerRetryAfter : undefined);
        throw new ApiClientError(
          `API ${res.status}: ${message}`,
          res.status,
          retryable,
          retryAfterSeconds && retryAfterSeconds > 0
            ? Math.ceil(retryAfterSeconds * 1000)
            : undefined,
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
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      removeExternalAbortListener?.();
    }
  }

  async generateText(params: GenerateTextParams): Promise<string> {
    this.lastGenerateRequestId = null;
    const preferredProvider =
      params.provider ||
      (import.meta.env.VITE_LLM_PROVIDER as 'openrouter' | 'gemini' | undefined) ||
      'openrouter';

    const makeReq = async (provider: 'openrouter' | 'gemini', model?: string) =>
      this.fetchWithAuth(params.onStream ? '/v1/llm/generate/stream' : '/v1/llm/generate', {
        method: 'POST',
        retryBudgetMs: BACKGROUND_LLM_RETRY_BUDGET_MS,
        body: JSON.stringify({
          prompt: params.prompt,
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
        }),
      });

    try {
      const res = await makeReq(preferredProvider);
      if (params.onStream && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let raw = '';
        let emittedText = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          raw += chunk;
          if (params.responseSchema) {
            const startMatch = /"text"\s*:\s*"/.exec(raw);
            if (startMatch?.index !== undefined) {
              const start = startMatch.index + startMatch[0].length;
              let end = start;
              let escaped = false;
              for (; end < raw.length; end += 1) {
                const char = raw[end];
                if (char === '"' && !escaped) break;
                escaped = char === '\\' && !escaped;
                if (char !== '\\') escaped = false;
              }
              try {
                const decoded = JSON.parse(`"${raw.slice(start, end)}"`) as string;
                const delta = decoded.slice(emittedText.length);
                if (delta) params.onStream(delta);
                emittedText = decoded;
              } catch {
                // Wait for the remainder of an escape sequence in the next chunk.
              }
            }
          } else {
            params.onStream(chunk);
          }
        }
        this.lastGenerateRequestId = this.lastRequestId;
        return raw;
      }
      const data = (await res.json()) as {
        text?: string;
        provider?: 'openrouter' | 'gemini';
        model?: string;
      };
      params.onResponseMetadata?.({ provider: data.provider, model: data.model });
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
        };
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
        };
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
        quality: params.quality,
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
              quality: params.image.quality,
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
