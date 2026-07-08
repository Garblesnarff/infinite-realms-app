/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { llmApiClient } from '@/infrastructure/api';

import * as loggerModule from '@/lib/logger';

import '@/lib/auth-gate';

const logger = (loggerModule as any).default;

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

    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('generateText', () => {
    it('should successfully generate text using the preferred provider', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ text: 'Generated response' }),
      });

      const result = await llmApiClient.generateText({ prompt: 'Hello' });

      expect(result).toBe('Generated response');
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/v1/llm/generate'), expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"prompt":"Hello"'),
      }));
      // Verify logger was used (info log on success in some paths)
      // Actually llmApiClient.generateText doesn't log on success by default
    });

    it('should include auth token from localStorage if present', async () => {
      mockGetItem.mockReturnValue('test-token');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ text: 'Response' }),
      });

      await llmApiClient.generateText({ prompt: 'Hello' });

      expect(mockFetch).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      }));
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

    it('should try fallback models on rate limit error (429)', async () => {
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
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('rate limited, trying fallback models'));
    });

    it('should throw the original error if all fallback models fail', async () => {
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
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/v1/images/generate'), expect.objectContaining({
        method: 'POST',
      }));
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
        expect.objectContaining({ method: 'PATCH' })
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

      // Advance through all 5 attempts
      // 1 (initial) + 4 (retries) = 5
      for (let i = 0; i < 5; i++) {
        await vi.runAllTimersAsync();
        // Wait a tick for the async loop to continue
        await Promise.resolve();
      }

      await expect(appendPromise).rejects.toThrow('API 404');
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

  describe('extractMemories', () => {
    it('should successfully extract memories', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ text: '["memory 1"]' }),
      });

      const result = await llmApiClient.extractMemories('Conversation context');

      expect(result).toBe('["memory 1"]');
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/v1/llm/extract'), expect.anything());
    });

    it('should return empty string and log warning on error', async () => {
      mockFetch.mockRejectedValue(new Error('API Error'));

      const result = await llmApiClient.extractMemories('context');

      expect(result).toBe('');
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Memory extraction failed'), expect.any(Error));
    });
  });

  describe('Offline Fallback', () => {
    it('should enter offline fallback mode on fetch TypeError', async () => {
      mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(llmApiClient.generateText({ prompt: 'test' })).rejects.toThrow('Failed to fetch');

      // Next call should fail immediately without fetch
      mockFetch.mockClear();
      await expect(llmApiClient.generateText({ prompt: 'test' })).rejects.toThrow('API unavailable');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should reset offline fallback after 30 seconds', async () => {
      (llmApiClient as any).useOfflineFallback = true;
      (llmApiClient as any).offlineFallbackSetAt = Date.now() - 31000;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ text: 'Back online' }),
      });

      const result = await llmApiClient.generateText({ prompt: 'test' });
      expect(result).toBe('Back online');
      expect(mockFetch).toHaveBeenCalled();
    });
  });
});
