import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { useAutosave } from '../useAutosave';

import logger from '@/lib/logger';

vi.mock('@/lib/logger', () => ({
  default: {
    error: vi.fn(),
  },
}));

describe('useAutosave', () => {
  const storageKey = 'test-key';
  const initialValue = { foo: 'bar' };

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should initialize and start saving (since useEffect runs on mount)', () => {
    const { result } = renderHook(() => useAutosave(storageKey, initialValue));
    // The effect runs on mount, so it immediately transitions to 'saving'
    expect(result.current.status).toBe('saving');
  });

  it('should save to localStorage after initial mount delay', async () => {
    const { result } = renderHook(() => useAutosave(storageKey, initialValue));

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(localStorage.getItem(storageKey)).toBe(JSON.stringify(initialValue));
    expect(result.current.status).toBe('saved');
  });

  it('should transition back to saving when value changes', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useAutosave(storageKey, value),
      { initialProps: { value: initialValue } },
    );

    // Initial save
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.status).toBe('saved');

    act(() => {
      rerender({ value: { foo: 'baz' } });
    });

    expect(result.current.status).toBe('saving');
  });

  it('should return to idle status after 1200ms of being saved', () => {
    const { result } = renderHook(() => useAutosave(storageKey, initialValue));

    act(() => {
      vi.advanceTimersByTime(1000); // Trigger save
    });

    expect(result.current.status).toBe('saved');

    act(() => {
      vi.advanceTimersByTime(1200);
    });

    expect(result.current.status).toBe('idle');
  });

  it('should debounce saves if value changes rapidly', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    const { rerender } = renderHook(
      ({ value }) => useAutosave(storageKey, value),
      { initialProps: { value: initialValue } },
    );

    // Initial mount triggers first save timer.
    // Let's let it finish so we have a clean slate for debouncing test.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    setItemSpy.mockClear();

    act(() => {
      rerender({ value: { foo: 'v1' } });
      vi.advanceTimersByTime(500);
      rerender({ value: { foo: 'v2' } });
      vi.advanceTimersByTime(500);
      rerender({ value: { foo: 'v3' } });
    });

    // None should have completed yet
    expect(setItemSpy).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(setItemSpy).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(storageKey)).toBe(JSON.stringify({ foo: 'v3' }));
  });

  it('should handle localStorage errors', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage full');
    });

    const { result } = renderHook(() => useAutosave(storageKey, initialValue));

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.status).toBe('error');
    expect(logger.error).toHaveBeenCalledWith('Autosave error', expect.any(Error));

    setItemSpy.mockRestore();
  });

  describe('restore', () => {
    it('should restore value from localStorage', () => {
      const savedValue = { hello: 'world' };
      localStorage.setItem(storageKey, JSON.stringify(savedValue));

      const { result } = renderHook(() => useAutosave(storageKey, initialValue));

      let restoredValue;
      act(() => {
        restoredValue = result.current.restore();
      });

      expect(restoredValue).toEqual(savedValue);
    });

    it('should return null if nothing in localStorage', () => {
      const { result } = renderHook(() => useAutosave(storageKey, initialValue));

      let restoredValue;
      act(() => {
        restoredValue = result.current.restore();
      });

      expect(restoredValue).toBeNull();
    });

    it('should handle JSON parse errors and return null', () => {
      localStorage.setItem(storageKey, 'invalid-json');
      const { result } = renderHook(() => useAutosave(storageKey, initialValue));

      let restoredValue;
      act(() => {
        restoredValue = result.current.restore();
      });

      expect(restoredValue).toBeNull();
      expect(logger.error).toHaveBeenCalledWith('Autosave restore failed', expect.any(Error));
    });
  });

  describe('clear', () => {
    it('should clear value from localStorage and set status to idle', () => {
      localStorage.setItem(storageKey, JSON.stringify(initialValue));
      const { result } = renderHook(() => useAutosave(storageKey, initialValue));

      act(() => {
        result.current.clear();
      });

      expect(localStorage.getItem(storageKey)).toBeNull();
      expect(result.current.status).toBe('idle');
    });

    it('should handle errors in clear', () => {
      const removeItemSpy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new Error('Remove failed');
      });
      const { result } = renderHook(() => useAutosave(storageKey, initialValue));

      act(() => {
        result.current.clear();
      });

      expect(logger.error).toHaveBeenCalledWith('Autosave clear failed', expect.any(Error));

      removeItemSpy.mockRestore();
    });
  });
});
