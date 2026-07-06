/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as webVitals from 'web-vitals';

import { reportWebVitals, getRecordedMetrics, clearRecordedMetrics } from '../web-vitals';

import logger from '@/lib/logger';

vi.mock('web-vitals', () => ({
  onCLS: vi.fn(),
  onINP: vi.fn(),
  onFCP: vi.fn(),
  onLCP: vi.fn(),
  onTTFB: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('web-vitals utility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('should register listeners for all core web vitals', () => {
    reportWebVitals();

    expect(webVitals.onCLS).toHaveBeenCalled();
    expect(webVitals.onINP).toHaveBeenCalled();
    expect(webVitals.onFCP).toHaveBeenCalled();
    expect(webVitals.onLCP).toHaveBeenCalled();
    expect(webVitals.onTTFB).toHaveBeenCalled();
  });

  it('should process and log metrics when they occur', () => {
    reportWebVitals();

    // Get the callback passed to onLCP
    const reportMetricCallback = vi.mocked(webVitals.onLCP).mock.calls[0][0];

    const mockMetric = {
      name: 'LCP',
      value: 2000, // Good
      delta: 2000,
      id: 'v4-12345',
      entries: [],
    };

    reportMetricCallback(mockMetric as any);

    // Verify logging - using regex to match color codes if present, but here logger.debug was called with just the string
    // In the source: logger.debug(`${color}[Performance] ${metric.name}: ${formattedValue} (${rating})${reset}`, { metric });
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('[Performance] LCP: 2000ms (good)'),
      expect.objectContaining({ metric: mockMetric })
    );

    // Verify persistence
    const recorded = getRecordedMetrics();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      name: 'LCP',
      value: 2000,
      rating: 'good'
    });
  });

  it('should handle CLS metric formatting correctly', () => {
    reportWebVitals();
    const reportMetricCallback = vi.mocked(webVitals.onCLS).mock.calls[0][0];

    const mockMetric = {
      name: 'CLS',
      value: 0.1234,
      delta: 0.1234,
      id: 'cls-123',
      entries: [],
    };

    reportMetricCallback(mockMetric as any);

    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('CLS: 0.123'),
      expect.any(Object)
    );
  });

  it('should correctly rate metrics based on thresholds', () => {
    reportWebVitals();

    // Helper to trigger and check
    const checkMetric = (onFn: any, name: string, value: number, expectedRating: string) => {
      const callback = vi.mocked(onFn).mock.calls[0][0];
      callback({ name, value } as any);
      const recorded = getRecordedMetrics();
      expect(recorded[recorded.length - 1].rating).toBe(expectedRating);
    };

    // FCP: good <= 1800, needs-improvement <= 3000, poor > 3000
    checkMetric(webVitals.onFCP, 'FCP', 1000, 'good');
    checkMetric(webVitals.onFCP, 'FCP', 2500, 'needs-improvement');
    checkMetric(webVitals.onFCP, 'FCP', 3500, 'poor');

    // INP: good <= 200, needs-improvement <= 500
    checkMetric(webVitals.onINP, 'INP', 150, 'good');
    checkMetric(webVitals.onINP, 'INP', 400, 'needs-improvement');
    checkMetric(webVitals.onINP, 'INP', 600, 'poor');
  });

  it('should call user-provided onPerfEntry callback', () => {
    const customCallback = vi.fn();
    reportWebVitals(customCallback);

    const reportMetricCallback = vi.mocked(webVitals.onTTFB).mock.calls[0][0];
    const mockMetric = { name: 'TTFB', value: 500 };

    reportMetricCallback(mockMetric as any);

    expect(customCallback).toHaveBeenCalledWith(mockMetric);
  });

  it('should handle unknown metric names by defaulting to good rating', () => {
    reportWebVitals();
    const reportMetricCallback = vi.mocked(webVitals.onLCP).mock.calls[0][0];

    reportMetricCallback({ name: 'UNKNOWN', value: 9999 } as any);

    const recorded = getRecordedMetrics();
    expect(recorded[recorded.length - 1].rating).toBe('good');
  });

  it('should handle sessionStorage errors gracefully', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded');
    });

    reportWebVitals();
    const reportMetricCallback = vi.mocked(webVitals.onLCP).mock.calls[0][0];
    reportMetricCallback({ name: 'LCP', value: 100 } as any);

    expect(logger.warn).toHaveBeenCalledWith('Failed to store web vitals', expect.objectContaining({ error: expect.any(Error) }));

    setItemSpy.mockRestore();
  });

  it('should clear recorded metrics', () => {
    sessionStorage.setItem('web-vitals', JSON.stringify([{ name: 'FCP', value: 100 }]));
    expect(getRecordedMetrics()).toHaveLength(1);

    clearRecordedMetrics();
    expect(getRecordedMetrics()).toHaveLength(0);
  });

  it('should return empty array if getRecordedMetrics fails to parse', () => {
    sessionStorage.setItem('web-vitals', 'invalid-json');
    expect(getRecordedMetrics()).toEqual([]);
  });
});
