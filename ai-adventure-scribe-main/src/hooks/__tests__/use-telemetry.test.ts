/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useTelemetry } from '../use-telemetry';

import telemetry from '@/lib/telemetry';

// Mock telemetry utility
vi.mock('@/lib/telemetry', () => ({
  default: {
    detectCrash: vi.fn(() => ({ crashed: false })),
    markSessionActive: vi.fn(),
    markSessionClean: vi.fn(),
    trackPageLifecycle: vi.fn(() => vi.fn()),
    startSessionHeartbeat: vi.fn(() => vi.fn()),
    logMemoryUsage: vi.fn(),
    getMemoryStats: vi.fn(),
    recordWebGLContextLoss: vi.fn(),
  },
  telemetry: {
    getMemoryStats: vi.fn(),
    logMemoryUsage: vi.fn(),
    markSessionActive: vi.fn(),
    markSessionClean: vi.fn(),
    recordWebGLContextLoss: vi.fn(),
    detectCrash: vi.fn(() => ({ crashed: false })),
    trackPageLifecycle: vi.fn(() => vi.fn()),
    startSessionHeartbeat: vi.fn(() => vi.fn()),
  }
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('useTelemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize telemetry with default options', () => {
    const sessionId = 'test-session';
    renderHook(() => useTelemetry({ sessionId }));

    expect(telemetry.markSessionActive).toHaveBeenCalledWith(sessionId);
    expect(telemetry.trackPageLifecycle).toHaveBeenCalledWith(sessionId);
    expect(telemetry.logMemoryUsage).toHaveBeenCalledWith(sessionId);
  });

  it('should detect crash when enabled', () => {
    (telemetry.detectCrash as any).mockReturnValue({ crashed: true, previousSessionId: 'old-session' });

    renderHook(() => useTelemetry({ enableCrashDetection: true }));

    expect(telemetry.detectCrash).toHaveBeenCalled();
  });

  it('should start heartbeat when enabled', () => {
    const sessionId = 'test-session';
    const interval = 5000;

    renderHook(() => useTelemetry({
      sessionId,
      enableHeartbeat: true,
      heartbeatInterval: interval
    }));

    expect(telemetry.startSessionHeartbeat).toHaveBeenCalledWith(sessionId, interval);
  });

  it('should call cleanup functions on unmount', () => {
    const lifecycleCleanup = vi.fn();
    const heartbeatCleanup = vi.fn();

    (telemetry.trackPageLifecycle as any).mockReturnValue(lifecycleCleanup);
    (telemetry.startSessionHeartbeat as any).mockReturnValue(heartbeatCleanup);

    const { unmount } = renderHook(() => useTelemetry({
      sessionId: 'test-session',
      enableHeartbeat: true,
      markSessionClean: true
    }));

    unmount();

    expect(heartbeatCleanup).toHaveBeenCalled();
    expect(lifecycleCleanup).toHaveBeenCalled();
    expect(telemetry.markSessionClean).toHaveBeenCalledWith('test-session');
  });

  it('should return telemetry utilities', () => {
    const { result } = renderHook(() => useTelemetry({ sessionId: 'test-session' }));

    expect(result.current.logMemory).toBeDefined();
    expect(result.current.getMemoryStats).toBeDefined();
    expect(result.current.recordWebGLContextLoss).toBeDefined();

    result.current.logMemory();
    expect(telemetry.logMemoryUsage).toHaveBeenCalledWith('test-session');
  });
});
