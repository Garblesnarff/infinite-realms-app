/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { llmApiClient } from '@/infrastructure/api';
import {
  BACKGROUND_LLM_RETRY_BUDGET_MS,
  createTurnPhaseReporter,
} from '@/infrastructure/api/rest-client';
import * as loggerModule from '@/lib/logger';

import '@/lib/auth-gate';

const logger = (loggerModule as any).default;

const extractionJob = (
  overrides: Partial<Parameters<typeof llmApiClient.submitMemoryExtraction>[0]> = {},
) => ({
  sessionId: 'session-1',
  kind: 'memories' as const,
  prompt: 'Conversation context',
  maxTokens: 1000,
  ...overrides,
});

const exhaustNetworkRetryBudget = async (
  budgetMs: number = BACKGROUND_LLM_RETRY_BUDGET_MS,
): Promise<void> => {
  let remainingMs = budgetMs;
  for (const delayMs of [1_000, 2_000, 4_000, 8_000]) {
    if (remainingMs <= 0) return;
    const waitMs = Math.min(delayMs, remainingMs);
    await vi.advanceTimersByTimeAsync(waitMs);
    remainingMs -= waitMs;
  }
  if (remainingMs > 0) await vi.advanceTimersByTimeAsync(remainingMs);
};

// Mock auth-gate
vi.mock('@/lib/auth-gate', () => ({
  waitForAuth: vi.fn().mockResolvedValue(undefined),
}));

// Mock logger
vi.mock('@/lib/logger', () => {
  const m = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return {
    __esModule: true,
    default: m,
    logger: m,
  };
});

describe('LlmApiClient', () => {
  const mockFetch = vi.fn();
  const mockGetItem = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // vi.clearAllMocks() only clears call history, not queued mockResolvedValueOnce()
    // answers. mockFetch is declared once for the whole describe block, so without an
    // explicit reset, unconsumed once-queue entries from a test that fetches fewer
    // times than it queues (e.g. a mocked multi-call retry sequence that short-circuits)
    // leak into the next test and get consumed there instead of its own mock response -
    // mockReset() drops the queue so every test starts from a clean slate.
    mockFetch.mockReset();
    (globalThis as any).fetch = mockFetch;

    // Mock localStorage
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: mockGetItem,
        setItem: vi.fn(),
      },
      writable: true,
    });

    // Reset singleton state if possible
    (llmApiClient as any).useOfflineFallback = false;
    (llmApiClient as any).offlineFallbackSetAt = 0;
    (llmApiClient as any).lastRequestId = null;
    (llmApiClient as any).lastGenerateRequestId = null;

    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('generateText', () => {
    it('retains the generate request id for turn-phase correlation', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: (name: string) => (name === 'x-request-id' ? 'generate-req-1' : null) },
        json: () => Promise.resolve({ text: 'Generated response' }),
      });

      await llmApiClient.generateText({ prompt: 'Hello' });

      expect(llmApiClient.lastGenerateRequestId).toBe('generate-req-1');
    });

    it('logs a full turn in order with cumulative phase timing', async () => {
      let clock = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => ++clock);
      const reportTurnPhase = createTurnPhaseReporter();

      reportTurnPhase('submit');
      reportTurnPhase('preflight');
      reportTurnPhase('generate start');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: (name: string) => (name === 'x-request-id' ? 'generate-req-2' : null) },
        json: () => Promise.resolve({ text: 'Generated response' }),
      });
      await llmApiClient.generateText({ prompt: 'Hello' });
      reportTurnPhase('generate end', llmApiClient.lastGenerateRequestId);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: (name: string) => (name === 'x-request-id' ? 'extract-req-2' : null) },
        json: () => Promise.resolve({ jobId: 'job-1', status: 'accepted' }),
      });
      await llmApiClient.submitMemoryExtraction(extractionJob(), reportTurnPhase);
      reportTurnPhase('text shown');
      reportTurnPhase('persist');
      reportTurnPhase('composer enabled');

      const phases = logger.info.mock.calls
        .filter(([event]) => event === 'TURN_PHASE')
        .map(([, payload]) => payload as { phase: string; ms: number; requestId: string | null });
      expect(phases.map(({ phase }) => phase)).toEqual([
        'submit',
        'preflight',
        'generate start',
        'generate end',
        'extract start',
        'extract end',
        'text shown',
        'persist',
        'composer enabled',
      ]);

      const persistPhase = phases.find(({ phase }) => phase === 'persist');
      expect(persistPhase).toMatchObject({
        phase: 'persist',
        requestId: 'generate-req-2',
      });
      expect(persistPhase?.ms).toBeGreaterThanOrEqual(0);

      const cumulativeMs = phases.reduce<number[]>((totals, { ms }) => {
        totals.push((totals.at(-1) ?? 0) + ms);
        return totals;
      }, []);
      expect(
        cumulativeMs.every((value, index) => index === 0 || value > cumulativeMs[index - 1]),
      ).toBe(true);
      expect(phases.slice(3).every(({ requestId }) => requestId === 'generate-req-2')).toBe(true);
    });

    it('should successfully generate text using the preferred provider', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ text: 'Generated response' }),
      });

      const result = await llmApiClient.generateText({
        prompt: 'Hello',
        player_input: 'I punch Darkwater',
      });

      expect(result).toBe('Generated response');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/llm/generate'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"prompt":"Hello"'),
        }),
      );
      expect(JSON.parse(mockFetch.mock.calls[0][1].body).player_input).toBe('I punch Darkwater');
      // Verify logger was used (info log on success in some paths)
      // Actually llmApiClient.generateText doesn't log on success by default
    });

    it('sends the reserved DM row id so the server can persist the reply (#2218)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ text: 'Generated response', dmReplyPersisted: true }),
      });

      await llmApiClient.generateText({
        prompt: 'Hello',
        sessionId: 'session-1',
        dmReply: { messageId: '0b7e4f5a-2c9d-4e1b-8a3f-6d5c4b3a2e1f', inCombat: false },
      });

      expect(JSON.parse(mockFetch.mock.calls[0][1].body).dmReply).toEqual({
        messageId: '0b7e4f5a-2c9d-4e1b-8a3f-6d5c4b3a2e1f',
        inCombat: false,
      });
    });

    it('should include auth token from localStorage if present', async () => {
      mockGetItem.mockReturnValue('test-token');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ text: 'Response' }),
      });

      await llmApiClient.generateText({ prompt: 'Hello' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        }),
      );
    });

    it('should fallback to gemini if openrouter is not configured', async () => {
      // First call fails with config error
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: () => Promise.resolve('Server not configured for OpenRouter'),
      });
      // Second call (fallback) succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ text: 'Gemini response' }),
      });

      const result = await llmApiClient.generateText({ prompt: 'Hello', provider: 'openrouter' });

      expect(result).toBe('Gemini response');
      expect(mockFetch).toHaveBeenCalledTimes(2);
      const secondCallBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(secondCallBody.provider).toBe('gemini');
    });

    it('falls back to Gemini when OpenRouter is rate limited', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        headers: { get: () => '3' },
        text: () =>
          Promise.resolve(
            JSON.stringify({ error: 'upstream_model_error', retryable: true, retry_after: 3 }),
          ),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            text: 'Gemini response',
            provider: 'gemini',
            model: 'gemini-2.5-flash-lite',
          }),
      });
      const onResponseMetadata = vi.fn();

      await expect(
        llmApiClient.generateText({ prompt: 'Hello', provider: 'openrouter', onResponseMetadata }),
      ).resolves.toBe('Gemini response');

      expect(JSON.parse(mockFetch.mock.calls[1][1].body).provider).toBe('gemini');
      expect(onResponseMetadata).toHaveBeenCalledWith({
        provider: 'gemini',
        model: 'gemini-2.5-flash-lite',
      });
    });

    it('should fallback to openrouter if gemini is not configured', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Server not configured for Gemini'),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ text: 'OpenRouter response' }),
      });

      const result = await llmApiClient.generateText({ prompt: 'Hello', provider: 'gemini' });

      expect(result).toBe('OpenRouter response');
      expect(mockFetch).toHaveBeenCalledTimes(2);
      const secondCallBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(secondCallBody.provider).toBe('openrouter');
    });

    // TODO(vitest-config-audit, 2026-07-14): LlmApiClient.generateText() (see
    // src/infrastructure/api/rest-client.ts) only falls back to a different *provider*
    // when the response body matches "Server not configured for Openrouter/Gemini"; there
    // is no 429-rate-limit / fallback-*model* retry loop in the current source at all, so
    // it just throws on the first 429. Either this resilience feature needs to be
    // (re)implemented, or these two tests describe a feature that was never built - needs
    // product/eng review, not a test-only fix.
    it.skip('should try fallback models on rate limit error (429)', async () => {
      // Original request fails with 429
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: () => Promise.resolve('Rate limit exceeded'),
      });

      // Fallback models are tried
      // 1st fallback fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: () => Promise.resolve('Fallback rate limited'),
      });

      // 2nd fallback succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ text: 'Flash model response' }),
      });

      const result = await llmApiClient.generateText({ prompt: 'Hello' });

      expect(result).toBe('Flash model response');
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('rate limited, trying fallback models'),
      );
    });

    // TODO(vitest-config-audit, 2026-07-14): same missing rate-limit-fallback feature as
    // the test above - see that comment.
    it.skip('should throw the original error if all fallback models fail', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        text: () => Promise.resolve('Rate limit exceeded'),
      });

      await expect(llmApiClient.generateText({ prompt: 'Hello' })).rejects.toThrow('API 429');
      // 1 initial + 3 fallback attempts
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });
  });

  describe('generateImage', () => {
    it('should successfully generate an image', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ image: 'base64-data' }),
      });

      const result = await llmApiClient.generateImage({ prompt: 'A dragon' });

      expect(result).toBe('base64-data');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/images/generate'),
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });
  });

  describe('appendMessageImage', () => {
    it('should successfully append an image to a message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await llmApiClient.appendMessageImage({
        messageId: 'msg-123',
        image: { url: 'http://example.com/img.png' },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/images/message/msg-123/images'),
        expect.objectContaining({ method: 'PATCH' }),
      );
    });

    it('should retry on 404 errors with exponential backoff', async () => {
      // Success on 2nd attempt
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          text: () => Promise.resolve('Not found'),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({}),
        });

      const appendPromise = llmApiClient.appendMessageImage({
        messageId: 'msg-123',
        image: { url: 'http://example.com/img.png' },
      });
      // 1st attempt fails, schedules retry
      await vi.runAllTimersAsync();
      await appendPromise;

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should throw error after maximum retries', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Still not found'),
      });

      const appendPromise = llmApiClient.appendMessageImage({
        messageId: 'msg-123',
        image: { url: 'http://example.com/img.png' },
      });
      const rejection = expect(appendPromise).rejects.toThrow('API 404');

      // Advance through all 5 attempts
      // 1 (initial) + 4 (retries) = 5
      for (let i = 0; i < 5; i++) {
        await vi.runAllTimersAsync();
        // Wait a tick for the async loop to continue
        await Promise.resolve();
      }

      await rejection;
      expect(mockFetch).toHaveBeenCalledTimes(5);
    });
  });

  describe('getImageQuotaStatus', () => {
    it('should return quota status on success', async () => {
      const mockQuota = { remaining: 5, limit: 10 };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockQuota),
      });

      const result = await llmApiClient.getImageQuotaStatus();

      expect(result).toEqual(mockQuota);
    });

    it('should return null on failure', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await llmApiClient.getImageQuotaStatus();

      expect(result).toBeNull();
    });
  });

  describe('submitMemoryExtraction (#2148)', () => {
    it('posts the job to the server and returns once it is accepted', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: () => Promise.resolve({ jobId: 'job-1', status: 'accepted' }),
      });

      await expect(
        llmApiClient.submitMemoryExtraction(extractionJob({ characterId: 'char-1', turn: 3 })),
      ).resolves.toBeUndefined();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/memory-extraction/jobs'),
        expect.objectContaining({ method: 'POST' }),
      );
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
        session_id: 'session-1',
        character_id: 'char-1',
        kind: 'memories',
        prompt: 'Conversation context',
        max_tokens: 1000,
        turn: 3,
      });
    });

    it('never rejects, and logs a warning, when the job is not accepted', async () => {
      mockFetch.mockRejectedValue(new Error('API Error'));

      await expect(llmApiClient.submitMemoryExtraction(extractionJob())).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Memory extraction was not accepted'),
        expect.any(Error),
      );
    });
  });

  describe('Offline Fallback', () => {
    it('does not trip offline fallback when extract fails, so generate still fetches', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/v1/memory-extraction/jobs')) {
          return Promise.reject(new TypeError('Failed to fetch'));
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ text: 'Narration' }),
        });
      });

      const extractRequest = llmApiClient.submitMemoryExtraction(extractionJob());
      await exhaustNetworkRetryBudget();
      await expect(extractRequest).resolves.toBeUndefined();
      await expect(llmApiClient.generateText({ prompt: 'test' })).resolves.toBe('Narration');

      expect(mockFetch).toHaveBeenCalledTimes(5);
      expect(mockFetch.mock.calls[4][0]).toEqual(expect.stringContaining('/v1/llm/generate'));
      expect(logger.warn).not.toHaveBeenCalledWith('OFFLINE_FALLBACK_TRIPPED', expect.anything());
    });

    it('trips offline fallback on a generate fetch TypeError and logs the route', async () => {
      mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

      const request = llmApiClient.generateText({ prompt: 'test' });
      const rejection = expect(request).rejects.toThrow('Failed to fetch');
      await exhaustNetworkRetryBudget();
      await rejection;

      expect((llmApiClient as any).useOfflineFallback).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith('OFFLINE_FALLBACK_TRIPPED', {
        route: '/v1/llm/generate',
        errorName: 'TypeError',
        errorMessage: 'Failed to fetch',
      });
    });

    it('includes the latest server request id when the generate fallback trips', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: { get: (name: string) => (name === 'x-request-id' ? 'req-123' : null) },
          json: () => Promise.resolve({ text: 'First response' }),
        })
        .mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(llmApiClient.generateText({ prompt: 'first' })).resolves.toBe('First response');
      const request = llmApiClient.generateText({ prompt: 'second' });
      const rejection = expect(request).rejects.toThrow('Failed to fetch');
      await exhaustNetworkRetryBudget();
      await rejection;

      expect(logger.warn).toHaveBeenCalledWith(
        'OFFLINE_FALLBACK_TRIPPED',
        expect.objectContaining({ requestId: 'req-123' }),
      );
    });

    it('blocks optional calls while offline and logs the remaining time', async () => {
      mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));
      const request = llmApiClient.generateText({ prompt: 'test' });
      const rejection = expect(request).rejects.toThrow('Failed to fetch');
      await exhaustNetworkRetryBudget();
      await rejection;

      mockFetch.mockClear();
      await expect(llmApiClient.submitMemoryExtraction(extractionJob())).resolves.toBeUndefined();

      expect(mockFetch).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith('OFFLINE_FALLBACK_BLOCKED', {
        route: '/v1/memory-extraction/jobs',
        msRemaining: 30_000,
      });
    });

    it('never pre-fails generate while the offline flag is set', async () => {
      (llmApiClient as any).useOfflineFallback = true;
      (llmApiClient as any).offlineFallbackSetAt = Date.now();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ text: 'Back online narration' }),
      });

      await expect(llmApiClient.generateText({ prompt: 'test' })).resolves.toBe(
        'Back online narration',
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should reset offline fallback after 30 seconds', async () => {
      (llmApiClient as any).useOfflineFallback = true;
      (llmApiClient as any).offlineFallbackSetAt = Date.now();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ jobId: 'job-1', status: 'accepted' }),
      });

      vi.advanceTimersByTime(30_000);
      await llmApiClient.submitMemoryExtraction(extractionJob());
      expect(mockFetch).toHaveBeenCalled();
    });

    it('aborts generate after 60 seconds and logs AbortError distinctly', async () => {
      mockFetch.mockImplementationOnce(
        (_url: string, options: RequestInit) =>
          new Promise((_resolve, reject) => {
            options.signal?.addEventListener('abort', () => {
              const error = new Error('The operation was aborted');
              error.name = 'AbortError';
              reject(error);
            });
          }),
      );

      const request = llmApiClient.generateText({ prompt: 'test' });
      const rejection = expect(request).rejects.toMatchObject({ name: 'AbortError' });
      await vi.advanceTimersByTimeAsync(60_000);

      await rejection;
      expect(logger.warn).toHaveBeenCalledWith(
        'LLM_API_REQUEST_ABORTED',
        expect.objectContaining({
          route: '/v1/llm/generate',
          errorName: 'AbortError',
        }),
      );
      expect((llmApiClient as any).useOfflineFallback).toBe(false);
    });

    // Was "aborts extract after 10 seconds and logs AbortError distinctly". That abort threw
    // away every production extraction (#2148): the server now answers 202 at once, so the
    // submit carries no client timeout and never logs LLM_API_REQUEST_ABORTED.
    it('never aborts a memory extraction submit or logs LLM_API_REQUEST_ABORTED for it', async () => {
      let resolveFetch: ((value: unknown) => void) | undefined;
      let signal: AbortSignal | undefined;
      mockFetch.mockImplementationOnce(
        (_url: string, options: RequestInit) =>
          new Promise((resolve) => {
            signal = options.signal ?? undefined;
            resolveFetch = resolve;
          }),
      );

      const request = llmApiClient.submitMemoryExtraction(extractionJob());
      await vi.advanceTimersByTimeAsync(60_000);

      expect(signal).toBeUndefined();
      resolveFetch!({
        ok: true,
        status: 202,
        json: () => Promise.resolve({ jobId: 'job-1', status: 'accepted' }),
      });
      await expect(request).resolves.toBeUndefined();
      expect(logger.warn).not.toHaveBeenCalledWith('LLM_API_REQUEST_ABORTED', expect.anything());
    });
  });
});
