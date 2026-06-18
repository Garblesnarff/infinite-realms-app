/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { handleStatusChange, handleFailure } from '../status-manager';

import type { TableSubscription } from '../types';

// Mock logger
vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('status-manager', () => {
  let mockSubscription: TableSubscription;
  let onFailure: any;

  beforeEach(() => {
    vi.useFakeTimers();
    onFailure = vi.fn();
    mockSubscription = {
      channel: null,
      recordCallbacks: new Map(),
      eventCallbacks: new Map(),
      retryCount: 0,
      isConnected: false,
      isConnecting: true,
      lastRetry: 0,
      connectionTimeoutId: setTimeout(() => {}, 1000) as any,
      cleanupTimeoutId: null,
      disabled: false,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('handleStatusChange', () => {
    it('should handle SUBSCRIBED status', () => {
      handleStatusChange('test_table', 'SUBSCRIBED', mockSubscription, onFailure);

      expect(mockSubscription.isConnected).toBe(true);
      expect(mockSubscription.retryCount).toBe(0);
      expect(mockSubscription.isConnecting).toBe(false);
      expect(mockSubscription.connectionTimeoutId).toBeNull();
      expect(onFailure).not.toHaveBeenCalled();
    });

    it('should handle CHANNEL_ERROR status', () => {
      handleStatusChange('test_table', 'CHANNEL_ERROR', mockSubscription, onFailure);

      expect(mockSubscription.isConnected).toBe(false);
      expect(mockSubscription.isConnecting).toBe(false);
      expect(onFailure).toHaveBeenCalled();
    });

    it('should handle TIMED_OUT status', () => {
      handleStatusChange('test_table', 'TIMED_OUT', mockSubscription, onFailure);

      expect(mockSubscription.isConnected).toBe(false);
      expect(mockSubscription.isConnecting).toBe(false);
      expect(onFailure).toHaveBeenCalled();
    });

    it('should handle CLOSED status', () => {
      handleStatusChange('test_table', 'CLOSED', mockSubscription, onFailure);

      expect(mockSubscription.isConnected).toBe(false);
      expect(mockSubscription.isConnecting).toBe(false);
      expect(mockSubscription.connectionTimeoutId).toBeNull();
      expect(onFailure).not.toHaveBeenCalled();
    });

    it('should do nothing for unknown status', () => {
      const initialState = { ...mockSubscription };
      handleStatusChange('test_table', 'UNKNOWN', mockSubscription, onFailure);
      // initialState has a timeout object which might not be strictly equal after spread if it's complex,
      // but here it's fine for the purpose of checking if other fields changed.
      expect(mockSubscription.isConnected).toBe(initialState.isConnected);
      expect(mockSubscription.isConnecting).toBe(initialState.isConnecting);
    });
  });

  describe('handleFailure', () => {
    it('should increment retry count and trigger retry action with exponential backoff', () => {
      const retryAction = vi.fn();
      const options = {
        maxRetries: 3,
        retryDelay: 1000,
        retryAction,
      };

      // First failure (2^0 * 1000 = 1000ms)
      handleFailure('test_table', mockSubscription, options);
      expect(mockSubscription.retryCount).toBe(1);
      expect(mockSubscription.isConnected).toBe(false);

      vi.advanceTimersByTime(1000);
      expect(retryAction).toHaveBeenCalledWith('test_table');

      // Second failure (2^1 * 1000 = 2000ms)
      handleFailure('test_table', mockSubscription, options);
      expect(mockSubscription.retryCount).toBe(2);

      vi.advanceTimersByTime(1000);
      expect(retryAction).toHaveBeenCalledTimes(1); // Not yet
      vi.advanceTimersByTime(1000);
      expect(retryAction).toHaveBeenCalledTimes(2);
    });

    it('should disable subscription when max retries are exceeded', () => {
      const retryAction = vi.fn();
      const options = {
        maxRetries: 1,
        retryDelay: 1000,
        retryAction,
      };

      handleFailure('test_table', mockSubscription, options);

      expect(mockSubscription.retryCount).toBe(1);
      expect(mockSubscription.disabled).toBe(true);
      expect(mockSubscription.connectionTimeoutId).toBeNull();

      vi.runAllTimers();
      expect(retryAction).not.toHaveBeenCalled();
    });
  });
});
