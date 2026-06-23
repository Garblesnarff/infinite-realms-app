import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import { ModelUsageTracker } from '../model-usage-tracker';

import logger from '@/lib/logger';

describe('ModelUsageTracker', () => {
  const STORAGE_KEY = 'ai-model-usage-tracker';
  let tracker: ModelUsageTracker;

  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    vi.clearAllMocks();

    // Mock system time to be deterministic
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-15T12:00:00Z'));

    // Create a new instance for each test
    tracker = new ModelUsageTracker();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initialization', () => {
    it('should initialize with empty data if localStorage is empty', () => {
      expect(tracker.getAllUsageData()).toEqual({});
    });

    it('should load data from localStorage on initialization', () => {
      const mockData = {
        'gpt-4': {
          modelId: 'gpt-4',
          dailyLimit: 10,
          usageCount: 5,
          lastResetDate: '2026-02-15',
        },
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(mockData));

      const newTracker = new ModelUsageTracker();
      expect(newTracker.getAllUsageData()).toEqual(mockData);
    });

    it('should handle corrupted JSON in localStorage gracefully', () => {
      localStorage.setItem(STORAGE_KEY, 'corrupted { json');
      const spy = vi.spyOn(logger, 'warn');

      const newTracker = new ModelUsageTracker();
      expect(newTracker.getAllUsageData()).toEqual({});
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('Failed to load usage data'), expect.anything());
    });
  });

  describe('canUseModel', () => {
    it('should return true for a new model', () => {
      expect(tracker.canUseModel('gpt-4', 10)).toBe(true);
    });

    it('should return true if usage is below limit', () => {
      tracker.recordUsage('gpt-4', 10);
      expect(tracker.canUseModel('gpt-4', 10)).toBe(true);
    });

    it('should return false if usage reaches limit', () => {
      for (let i = 0; i < 10; i++) {
        tracker.recordUsage('gpt-4', 10);
      }
      expect(tracker.canUseModel('gpt-4', 10)).toBe(false);
    });

    it('should update daily limit if it changes', () => {
      tracker.recordUsage('gpt-4', 10);
      tracker.canUseModel('gpt-4', 20);

      const stats = tracker.getUsageStats('gpt-4', 20);
      expect(stats.limit).toBe(20);
    });
  });

  describe('recordUsage', () => {
    it('should increment usage count and save to localStorage', () => {
      const count = tracker.recordUsage('gpt-4', 10);
      expect(count).toBe(1);

      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      expect(stored['gpt-4'].usageCount).toBe(1);
    });

    it('should handle localStorage errors during save', () => {
      const logSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('Quota exceeded');
      });

      tracker.recordUsage('gpt-4', 10);
      expect(setItemSpy).toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to save usage data'),
        expect.any(Error)
      );

      setItemSpy.mockRestore();
    });
  });

  describe('getRemainingUsage', () => {
    it('should return correct remaining count', () => {
      tracker.recordUsage('gpt-4', 10);
      expect(tracker.getRemainingUsage('gpt-4', 10)).toBe(9);
    });

    it('should not return negative remaining count', () => {
      // Force usage over limit for testing
      for (let i = 0; i < 15; i++) {
        tracker.recordUsage('gpt-4', 10);
      }
      expect(tracker.getRemainingUsage('gpt-4', 10)).toBe(0);
    });
  });

  describe('daily reset logic', () => {
    it('should reset counts when the date changes', () => {
      // Set initial usage
      tracker.recordUsage('gpt-4', 10);
      expect(tracker.getRemainingUsage('gpt-4', 10)).toBe(9);

      // Advance time by one day
      vi.setSystemTime(new Date('2026-02-16T12:00:00Z'));

      // Create new tracker to trigger reset logic in constructor
      const newTracker = new ModelUsageTracker();

      // Check if count was reset
      expect(newTracker.getRemainingUsage('gpt-4', 10)).toBe(10);

      const stats = newTracker.getUsageStats('gpt-4', 10);
      expect(stats.used).toBe(0);
    });

    it('should not reset counts if it is still the same day', () => {
      tracker.recordUsage('gpt-4', 10);

      // Advance time by few hours
      vi.setSystemTime(new Date('2026-02-15T18:00:00Z'));

      const newTracker = new ModelUsageTracker();
      expect(newTracker.getRemainingUsage('gpt-4', 10)).toBe(9);
    });
  });

  describe('resetModelUsage', () => {
    it('should manually reset usage for a specific model', () => {
      tracker.recordUsage('gpt-4', 10);
      tracker.resetModelUsage('gpt-4');

      expect(tracker.getRemainingUsage('gpt-4', 10)).toBe(10);
    });

    it('should do nothing if model does not exist', () => {
      const spy = vi.spyOn(logger, 'info');
      tracker.resetModelUsage('non-existent');
      expect(spy).not.toHaveBeenCalledWith(expect.stringContaining('Usage reset for model'));
    });
  });

  describe('getUsageStats', () => {
    it('should return complete usage statistics', () => {
      tracker.recordUsage('gpt-4', 10);
      tracker.recordUsage('gpt-4', 10);

      const stats = tracker.getUsageStats('gpt-4', 10);
      expect(stats).toEqual({
        used: 2,
        limit: 10,
        remaining: 8,
      });
    });
  });
});
