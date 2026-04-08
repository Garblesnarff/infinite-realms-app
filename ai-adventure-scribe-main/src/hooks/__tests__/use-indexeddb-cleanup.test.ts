/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { IndexedDBService } from '../../agents/messaging/services/storage/IndexedDBService';
import { useIndexedDBCleanup, formatCleanupStats, timeSinceLastCleanup } from '../use-indexeddb-cleanup';

vi.mock('../../agents/messaging/services/storage/IndexedDBService', () => {
  const mockInstance = {
    getCleanupStats: vi.fn(),
    manualCleanup: vi.fn(),
  };
  return {
    IndexedDBService: {
      getInstance: vi.fn(() => mockInstance),
    },
  };
});

vi.mock('../../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe('useIndexedDBCleanup', () => {
  const mockStats = {
    lastCleanupTime: 1000000,
    totalMessagesDeleted: 10,
    lastDeletedCount: 5,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    const service = IndexedDBService.getInstance();
    (service.getCleanupStats as any).mockReturnValue(mockStats);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should initialize with stats from IndexedDBService', () => {
    const { result } = renderHook(() => useIndexedDBCleanup());
    expect(result.current.stats).toEqual(mockStats);
  });

  it('should refresh stats when refreshStats is called', () => {
    const { result } = renderHook(() => useIndexedDBCleanup());
    const service = IndexedDBService.getInstance();
    const newStats = { ...mockStats, totalMessagesDeleted: 20 };
    (service.getCleanupStats as any).mockReturnValue(newStats);

    act(() => {
      result.current.refreshStats();
    });

    expect(result.current.stats).toEqual(newStats);
  });

  it('should handle manual cleanup successfully', async () => {
    const { result } = renderHook(() => useIndexedDBCleanup());
    const service = IndexedDBService.getInstance();
    (service.manualCleanup as any).mockResolvedValue(5);

    let deletedCount;
    await act(async () => {
      deletedCount = await result.current.manualCleanup(5000);
    });

    expect(deletedCount).toBe(5);
    expect(service.manualCleanup).toHaveBeenCalledWith(5000);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should handle manual cleanup errors', async () => {
    const { result } = renderHook(() => useIndexedDBCleanup());
    const service = IndexedDBService.getInstance();
    const error = new Error('Cleanup failed');
    (service.manualCleanup as any).mockRejectedValue(error);

    await act(async () => {
      try {
        await result.current.manualCleanup();
      } catch (e) {
        // expected
      }
    });

    expect(result.current.error).toBe('Cleanup failed');
    expect(result.current.isLoading).toBe(false);
  });

  it('should handle non-Error objects in refreshStats catch block', () => {
    const { result } = renderHook(() => useIndexedDBCleanup());
    const service = IndexedDBService.getInstance();
    (service.getCleanupStats as any).mockImplementation(() => {
      // eslint-disable-next-line no-throw-literal
      throw 'string error';
    });

    act(() => {
      result.current.refreshStats();
    });

    expect(result.current.error).toBe('Failed to get cleanup stats');
  });

  it('should handle non-Error objects in manualCleanup catch block', async () => {
    const { result } = renderHook(() => useIndexedDBCleanup());
    const service = IndexedDBService.getInstance();
    (service.manualCleanup as any).mockRejectedValue('string error');

    await act(async () => {
      try {
        await result.current.manualCleanup();
      } catch (e) {
        // expected
      }
    });

    expect(result.current.error).toBe('Cleanup failed');
    expect(result.current.isLoading).toBe(false);
  });

  it('should refresh stats periodically', () => {
    renderHook(() => useIndexedDBCleanup());
    const service = IndexedDBService.getInstance();
    vi.clearAllMocks();

    act(() => {
      vi.advanceTimersByTime(5 * 60 * 1000);
    });

    expect(service.getCleanupStats).toHaveBeenCalled();
  });
});

describe('formatCleanupStats', () => {
  it('should format stats correctly', () => {
    const stats = {
      lastCleanupTime: new Date('2023-01-01T12:00:00Z').getTime(),
      totalMessagesDeleted: 1000,
      lastDeletedCount: 50,
    };
    const formatted = formatCleanupStats(stats);
    expect(formatted.totalDeletedText).toBe('1,000');
    expect(formatted.lastDeletedText).toBe('50');
    expect(formatted.lastCleanupText).toContain('2023');
  });

  it('should return "Never" for lastCleanupTime 0', () => {
    const stats = {
      lastCleanupTime: 0,
      totalMessagesDeleted: 0,
      lastDeletedCount: 0,
    };
    const formatted = formatCleanupStats(stats);
    expect(formatted.lastCleanupText).toBe('Never');
  });
});

describe('timeSinceLastCleanup', () => {
  it('should return "Never" for 0', () => {
    expect(timeSinceLastCleanup(0)).toBe('Never');
  });

  it('should return minutes ago', () => {
    const now = Date.now();
    expect(timeSinceLastCleanup(now - 5 * 60 * 1000)).toBe('5 minutes ago');
  });

  it('should return hours ago', () => {
    const now = Date.now();
    expect(timeSinceLastCleanup(now - 2 * 60 * 60 * 1000)).toBe('2 hours ago');
  });

  it('should return days ago', () => {
    const now = Date.now();
    expect(timeSinceLastCleanup(now - 48 * 60 * 60 * 1000)).toBe('2 days ago');
  });
});
