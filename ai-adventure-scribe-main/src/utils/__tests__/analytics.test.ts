/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initializeAnalytics, trackEvent, trackPageView } from '../analytics';
import { logger } from '@/lib/logger';

// Mock logger
vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('analytics utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear global gtag and dataLayer
    (window as any).gtag = undefined;
    (window as any).dataLayer = undefined;

    // Mock document methods
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({
        async: false,
        src: '',
      })),
      head: {
        appendChild: vi.fn(),
      },
      location: {
        pathname: '/test-path',
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('initializeAnalytics', () => {
    it('should log a warning if VITE_GA_MEASUREMENT_ID is missing', () => {
      vi.stubEnv('VITE_GA_MEASUREMENT_ID', '');
      initializeAnalytics();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Google Analytics not configured'), expect.any(Object));
    });

    it('should log a warning if VITE_GA_MEASUREMENT_ID format is invalid', () => {
      vi.stubEnv('VITE_GA_MEASUREMENT_ID', 'invalid-id');
      initializeAnalytics();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Invalid Google Analytics measurement ID format'), expect.any(Object));
    });

    it('should initialize GA if VITE_GA_MEASUREMENT_ID is valid', () => {
      const measurementId = 'G-1234567890';
      vi.stubEnv('VITE_GA_MEASUREMENT_ID', measurementId);

      initializeAnalytics();

      expect(window.dataLayer).toBeDefined();
      expect((window as any).gtag).toBeDefined();
      expect(document.createElement).toHaveBeenCalledWith('script');
      expect(document.head.appendChild).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Google Analytics initialized'), expect.any(Object));
    });

    it('should handle initialization errors gracefully', () => {
      vi.stubEnv('VITE_GA_MEASUREMENT_ID', 'G-1234567890');
      (document.createElement as any).mockImplementation(() => {
        throw new Error('Script creation failed');
      });

      initializeAnalytics();
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to initialize Google Analytics'), expect.any(Object));
    });
  });

  describe('trackEvent', () => {
    it('should call gtag if initialized', () => {
      const gtag = vi.fn();
      (window as any).gtag = gtag;

      trackEvent('test_event', { param: 'value' });

      expect(gtag).toHaveBeenCalledWith('event', 'test_event', { param: 'value' });
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Analytics event tracked'), expect.any(Object));
    });

    it('should log debug if not initialized', () => {
      (window as any).gtag = undefined;

      trackEvent('test_event');

      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Analytics not initialized'), expect.any(Object));
    });
  });

  describe('trackPageView', () => {
    it('should call gtag with page_view event', () => {
      const gtag = vi.fn();
      (window as any).gtag = gtag;

      trackPageView('/new-path', 'New Title');

      expect(gtag).toHaveBeenCalledWith('event', 'page_view', {
        page_path: '/new-path',
        page_title: 'New Title',
      });
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Page view tracked'), expect.any(Object));
    });
  });
});
