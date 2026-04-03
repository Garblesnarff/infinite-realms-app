/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import logger from './logger';
import { telemetry } from './telemetry';

describe('Telemetry Utility', () => {
  // Mock sessionStorage
  const mockSessionStorage: Record<string, string> = {};
  const sessionStorageSpy = {
    getItem: vi.fn((key: string) => mockSessionStorage[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      mockSessionStorage[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete mockSessionStorage[key];
    }),
  };

  // Mock performance.memory
  const originalPerformance = global.performance;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockSessionStorage).forEach((key) => delete mockSessionStorage[key]);

    // Setup sessionStorage mock
    vi.stubGlobal('sessionStorage', sessionStorageSpy);

    // Mock logger
    vi.mock('./logger', () => ({
      default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      },
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    global.performance = originalPerformance;
  });

  describe('getMemoryStats', () => {
    it('should return null when performance.memory is not available', () => {
      vi.stubGlobal('performance', {});
      expect(telemetry.getMemoryStats()).toBeNull();
    });

    it('should return stats when performance.memory is available', () => {
      vi.stubGlobal('performance', {
        memory: {
          usedJSHeapSize: 50 * 1024 * 1024,
          totalJSHeapSize: 100 * 1024 * 1024,
          jsHeapSizeLimit: 200 * 1024 * 1024,
        },
      });

      const stats = telemetry.getMemoryStats();
      expect(stats).toEqual({
        usedMB: 50,
        totalMB: 100,
        limitMB: 200,
        percentage: 25,
      });
    });
  });

  describe('logMemoryUsage', () => {
    it('should log memory usage at info level when percentage <= 80', () => {
      vi.stubGlobal('performance', {
        memory: {
          usedJSHeapSize: 50 * 1024 * 1024,
          jsHeapSizeLimit: 100 * 1024 * 1024,
        },
      });

      telemetry.logMemoryUsage('test-session');
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Memory usage'), expect.objectContaining({
        percentage: 50,
        sessionId: 'test-session',
      }));
    });

    it('should log memory usage at warn level when percentage > 80', () => {
      vi.stubGlobal('performance', {
        memory: {
          usedJSHeapSize: 90 * 1024 * 1024,
          jsHeapSizeLimit: 100 * 1024 * 1024,
        },
      });

      telemetry.logMemoryUsage('test-session');
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('High memory usage'), expect.objectContaining({
        percentage: 90,
      }));
    });
  });

  describe('Session Marking', () => {
    it('should mark session as active', () => {
      telemetry.markSessionActive('session-123');
      expect(sessionStorageSpy.setItem).toHaveBeenCalledWith('infiniteRealms_activeSession', 'session-123');
      expect(sessionStorageSpy.removeItem).toHaveBeenCalledWith('infiniteRealms_cleanShutdown');
    });

    it('should mark session as clean', () => {
      telemetry.markSessionClean('session-123');
      expect(sessionStorageSpy.setItem).toHaveBeenCalledWith('infiniteRealms_cleanShutdown', 'session-123');
      expect(sessionStorageSpy.removeItem).toHaveBeenCalledWith('infiniteRealms_activeSession');
    });

    it('should record WebGL context loss', () => {
      const now = 1234567890;
      vi.spyOn(Date, 'now').mockReturnValue(now);

      telemetry.recordWebGLContextLoss();
      expect(sessionStorageSpy.setItem).toHaveBeenCalledWith('infiniteRealms_webglContextLost', now.toString());
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('WebGL context loss'), expect.any(Object));
    });
  });

  describe('detectCrash', () => {
    it('should detect crash when active session exists without clean shutdown', () => {
      mockSessionStorage['infiniteRealms_activeSession'] = 'crashed-session';

      const result = telemetry.detectCrash();
      expect(result.crashed).toBe(true);
      expect(result.previousSessionId).toBe('crashed-session');
      expect(sessionStorageSpy.removeItem).toHaveBeenCalledWith('infiniteRealms_activeSession');
    });

    it('should include WebGL context loss info if available', () => {
      mockSessionStorage['infiniteRealms_activeSession'] = 'crashed-session';
      mockSessionStorage['infiniteRealms_webglContextLost'] = '1000';

      const result = telemetry.detectCrash();
      expect(result.webglContextLostAt).toBe(1000);
    });

    it('should not detect crash if clean shutdown exists', () => {
      mockSessionStorage['infiniteRealms_activeSession'] = 'session-1';
      mockSessionStorage['infiniteRealms_cleanShutdown'] = 'session-1';

      const result = telemetry.detectCrash();
      expect(result.crashed).toBe(false);
    });

    it('should handle errors gracefully', () => {
      sessionStorageSpy.getItem.mockImplementationOnce(() => {
        throw new Error('Storage failed');
      });

      const result = telemetry.detectCrash();
      expect(result.crashed).toBe(false);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('trackPageLifecycle', () => {
    it('should register and unregister event listeners', () => {
      const addSpy = vi.spyOn(window, 'addEventListener');
      const removeSpy = vi.spyOn(window, 'removeEventListener');
      const docAddSpy = vi.spyOn(document, 'addEventListener');
      const docRemoveSpy = vi.spyOn(document, 'removeEventListener');

      const cleanup = telemetry.trackPageLifecycle('session-1');

      expect(docAddSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
      expect(addSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
      expect(addSpy).toHaveBeenCalledWith('pagehide', expect.any(Function));

      cleanup();

      expect(docRemoveSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
      expect(removeSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
      expect(removeSpy).toHaveBeenCalledWith('pagehide', expect.any(Function));
    });

    it('should log when visibility changes', () => {
      telemetry.trackPageLifecycle('session-1');

      // Simulate visibility change
      vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
      const visibilityHandler = (document.addEventListener as any).mock.calls.find(
        (call: any) => call[0] === 'visibilitychange'
      )[1];

      visibilityHandler();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Tab visibility changed: HIDDEN'), expect.any(Object));
    });
  });

  describe('startSessionHeartbeat', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should start a heartbeat interval and log stats', () => {
      const cleanup = telemetry.startSessionHeartbeat('session-1', 1000);

      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('heartbeat started'), expect.any(Object));

      vi.advanceTimersByTime(1000);
      expect(logger.debug).toHaveBeenCalledWith('💓 Session heartbeat', expect.objectContaining({
        sessionId: 'session-1',
      }));

      cleanup();
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('heartbeat stopped'), expect.any(Object));
    });

    it('should warn if memory usage is high during heartbeat', () => {
      vi.stubGlobal('performance', {
        memory: {
          usedJSHeapSize: 90 * 1024 * 1024,
          jsHeapSizeLimit: 100 * 1024 * 1024,
        },
      });

      telemetry.startSessionHeartbeat('session-1', 1000);
      vi.advanceTimersByTime(1000);

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('High memory usage in session'), expect.any(Object));
    });
  });
});
