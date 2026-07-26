import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { keyFor, getOrCreateDeduped } from '../utils';

import logger from '@/lib/logger';

vi.mock('@/lib/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('AI Shared Utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('keyFor', () => {
    it('should generate a consistent key', () => {
      const key1 = keyFor('session-1', 'message content', 5);
      const key2 = keyFor('session-1', 'message content', 5);
      expect(key1).toBe(key2);
      expect(key1).toBe('session-1|message content|5');
    });

    it('should handle missing sessionId', () => {
      const key = keyFor(undefined, 'hello', 0);
      expect(key).toBe('nosession|hello|0');
    });

    it('should truncate long messages in the key', () => {
      const longMessage = 'a'.repeat(500);
      const key = keyFor('sid', longMessage, 1);
      expect(key).toBe(`sid|${'a'.repeat(256)}|1`);
    });
  });

  describe('getOrCreateDeduped', () => {
    it('should create and return a new promise', async () => {
      const factory = vi.fn().mockResolvedValue('result');
      const promise = getOrCreateDeduped('test-key', factory);

      expect(factory).toHaveBeenCalledTimes(1);
      const result = await promise;
      expect(result).toBe('result');
    });

    it('should return existing promise for the same key', async () => {
      let resolveFn: (val: string) => void = () => {};
      const factory = vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveFn = resolve;
          }),
      );

      const promise1 = getOrCreateDeduped('dedupe-key', factory);
      const promise2 = getOrCreateDeduped('dedupe-key', factory);

      expect(factory).toHaveBeenCalledTimes(1);
      expect(promise1).toBe(promise2);

      resolveFn('finished');
      expect(await promise1).toBe('finished');
      expect(await promise2).toBe('finished');
    });

    it('should log when deduping', async () => {
      const factory = vi.fn().mockResolvedValue('ok');
      getOrCreateDeduped('log-key', factory);
      getOrCreateDeduped('log-key', factory);

      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Deduping'), 'log-key');
    });

    it('should expire entries after 2 seconds', async () => {
      const factory1 = vi.fn().mockResolvedValue('first');
      const factory2 = vi.fn().mockResolvedValue('second');

      getOrCreateDeduped('expiry-key', factory1);
      expect(factory1).toHaveBeenCalledTimes(1);

      // Advance time by 2001ms
      vi.advanceTimersByTime(2001);

      getOrCreateDeduped('expiry-key', factory2);
      expect(factory2).toHaveBeenCalledTimes(1);

      expect(await getOrCreateDeduped('expiry-key', factory2)).toBe('second');
    });

    it('should clean up multiple expired entries', () => {
      const factory = vi.fn().mockResolvedValue('val');

      getOrCreateDeduped('key1', factory);
      vi.advanceTimersByTime(1000);
      getOrCreateDeduped('key2', factory);

      vi.advanceTimersByTime(1100);
      // Now key1 is 2100ms old (expired), key2 is 1100ms old (not expired)

      getOrCreateDeduped('key3', factory);
      // During key3 creation, it should clean up key1.
      // We can't easily check the private inFlight map, but we can verify it doesn't crash
      // and logic holds if we were to try 'key1' again.

      vi.advanceTimersByTime(1000); // key2 is now 2100ms old
      getOrCreateDeduped('key1', factory); // key1 should be fresh again
      expect(factory).toHaveBeenCalledTimes(4); // key1, key2, key3, key1 again
    });
  });
});
