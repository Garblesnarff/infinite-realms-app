import { describe, it, expect, vi, beforeEach } from 'vitest';

import { isOnline, isOffline, addNetworkListener } from '../network';

describe('network utilities', () => {
  describe('isOnline', () => {
    it('should return true when navigator.onLine is true', () => {
      Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
      expect(isOnline()).toBe(true);
    });

    it('should return false when navigator.onLine is false', () => {
      Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
      expect(isOnline()).toBe(false);
    });

    it('should return true if window is undefined (SSR)', () => {
      const originalWindow = global.window;
      // @ts-ignore
      delete global.window;
      expect(isOnline()).toBe(true);
      global.window = originalWindow;
    });

    it('should return true if onLine is not a boolean', () => {
      Object.defineProperty(window.navigator, 'onLine', { value: 'not-a-boolean', configurable: true });
      expect(isOnline()).toBe(true);
    });
  });

  describe('isOffline', () => {
    it('should return true when navigator.onLine is false', () => {
      Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
      expect(isOffline()).toBe(true);
    });

    it('should return false when navigator.onLine is true', () => {
      Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
      expect(isOffline()).toBe(false);
    });
  });

  describe('addNetworkListener', () => {
    beforeEach(() => {
      vi.stubGlobal('window', {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });
    });

    it('should add event listener and return cleanup function', () => {
      const handler = vi.fn();
      const cleanup = addNetworkListener('online', handler);

      expect(window.addEventListener).toHaveBeenCalledWith('online', handler);

      cleanup();
      expect(window.removeEventListener).toHaveBeenCalledWith('online', handler);
    });

    it('should return noop if window is undefined (SSR)', () => {
      vi.stubGlobal('window', undefined);
      const handler = vi.fn();
      const cleanup = addNetworkListener('online', handler);

      expect(typeof cleanup).toBe('function');
      cleanup(); // Should not throw
    });
  });
});
