 
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useLocalStorage, useLocalStorageString } from '../use-local-storage';

describe('useLocalStorage', () => {
  const key = 'test-key';
  const defaultValue = { a: 1 };

  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it('should return default value when localStorage is empty', () => {
    const { result } = renderHook(() => useLocalStorage(key, defaultValue));
    expect(result.current[0]).toEqual(defaultValue);
  });

  it('should return value from localStorage when it exists', () => {
    const value = { a: 2 };
    window.localStorage.setItem(key, JSON.stringify(value));
    const { result } = renderHook(() => useLocalStorage(key, defaultValue));
    expect(result.current[0]).toEqual(value);
  });

  it('should handle boolean values specifically (1/0)', () => {
    const { result: resultTrue } = renderHook(() => useLocalStorage('bool-key-1', true));
    expect(resultTrue.current[0]).toBe(true);

    const { result: resultFalse } = renderHook(() => useLocalStorage('bool-key-2', false));
    expect(resultFalse.current[0]).toBe(false);

    // Test loading '1' as true
    window.localStorage.setItem('bool-key-1', '1');
    const { result: resultLoadedTrue } = renderHook(() => useLocalStorage('bool-key-1', false));
    expect(resultLoadedTrue.current[0]).toBe(true);

    // Test loading '0' as false
    window.localStorage.setItem('bool-key-2', '0');
    const { result: resultLoadedFalse } = renderHook(() => useLocalStorage('bool-key-2', true));
    expect(resultLoadedFalse.current[0]).toBe(false);
  });

  it('should update localStorage when setValue is called', () => {
    const { result } = renderHook(() => useLocalStorage(key, defaultValue));
    const newValue = { a: 3 };

    act(() => {
      result.current[1](newValue);
    });

    expect(result.current[0]).toEqual(newValue);
    expect(window.localStorage.getItem(key)).toBe(JSON.stringify(newValue));
  });

  it('should update localStorage with "1"/"0" for boolean values', () => {
    const { result } = renderHook(() => useLocalStorage('bool-test', false));

    act(() => {
      result.current[1](true);
    });

    expect(result.current[0]).toBe(true);
    expect(window.localStorage.getItem('bool-test')).toBe('1');

    act(() => {
      result.current[1](false);
    });

    expect(result.current[0]).toBe(false);
    expect(window.localStorage.getItem('bool-test')).toBe('0');
  });

  it('should handle functional updates', () => {
    const { result } = renderHook(() => useLocalStorage<number>('count', 0));

    act(() => {
      result.current[1]((prev) => prev + 1);
    });

    expect(result.current[0]).toBe(1);
    expect(window.localStorage.getItem('count')).toBe(JSON.stringify(1));
  });

  it('should sync with other tabs via StorageEvent', () => {
    const { result } = renderHook(() => useLocalStorage(key, defaultValue));
    const newValue = { a: 4 };

    act(() => {
      const event = new StorageEvent('storage', {
        key: key,
        newValue: JSON.stringify(newValue),
        storageArea: window.localStorage,
      });
      window.dispatchEvent(event);
    });

    expect(result.current[0]).toEqual(newValue);
  });

  it('should return defaultValue when StorageEvent newValue is null', () => {
    const { result } = renderHook(() => useLocalStorage(key, defaultValue));

    act(() => {
      const event = new StorageEvent('storage', {
        key: key,
        newValue: null,
        storageArea: window.localStorage,
      });
      window.dispatchEvent(event);
    });

    expect(result.current[0]).toEqual(defaultValue);
  });

  it('should handle StorageEvent for boolean values', () => {
    const { result } = renderHook(() => useLocalStorage('bool-sync', false));

    act(() => {
      const event = new StorageEvent('storage', {
        key: 'bool-sync',
        newValue: '1',
        storageArea: window.localStorage,
      });
      window.dispatchEvent(event);
    });

    expect(result.current[0]).toBe(true);
  });

  it('should handle malformed JSON in localStorage gracefully', () => {
    window.localStorage.setItem(key, 'not-json');
    const { result } = renderHook(() => useLocalStorage(key, defaultValue));
    expect(result.current[0]).toEqual(defaultValue);
  });

  it('should handle localStorage.getItem errors gracefully', () => {
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Storage error');
    });

    const { result } = renderHook(() => useLocalStorage(key, defaultValue));
    expect(result.current[0]).toEqual(defaultValue);
    getItemSpy.mockRestore();
  });

  it('should handle localStorage.setItem errors gracefully', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage full');
    });

    const { result } = renderHook(() => useLocalStorage(key, defaultValue));

    act(() => {
      result.current[1]({ a: 10 });
    });

    // Value should still update in state even if storage fails
    expect(result.current[0]).toEqual({ a: 10 });

    setItemSpy.mockRestore();
  });
});

describe('useLocalStorageString', () => {
  const key = 'test-string-key';
  const defaultValue = 'default';

  beforeEach(() => {
    window.localStorage.clear();
  });

  it('should return default value when localStorage is empty', () => {
    const { result } = renderHook(() => useLocalStorageString(key, defaultValue));
    expect(result.current[0]).toBe(defaultValue);
  });

  it('should return value from localStorage when it exists', () => {
    const value = 'stored-value';
    window.localStorage.setItem(key, value);
    const { result } = renderHook(() => useLocalStorageString(key, defaultValue));
    expect(result.current[0]).toBe(value);
  });

  it('should update localStorage when setValue is called', () => {
    const { result } = renderHook(() => useLocalStorageString(key, defaultValue));
    const newValue = 'new-value';

    act(() => {
      result.current[1](newValue);
    });

    expect(result.current[0]).toBe(newValue);
    expect(window.localStorage.getItem(key)).toBe(newValue);
  });

  it('should handle functional updates', () => {
    const { result } = renderHook(() => useLocalStorageString(key, 'hello'));

    act(() => {
      result.current[1]((prev) => prev + ' world');
    });

    expect(result.current[0]).toBe('hello world');
    expect(window.localStorage.getItem(key)).toBe('hello world');
  });

  it('should sync with other tabs via StorageEvent', () => {
    const { result } = renderHook(() => useLocalStorageString(key, defaultValue));
    const newValue = 'synced-value';

    act(() => {
      const event = new StorageEvent('storage', {
        key: key,
        newValue: newValue,
        storageArea: window.localStorage,
      });
      window.dispatchEvent(event);
    });

    expect(result.current[0]).toBe(newValue);
  });

  it('should handle localStorage.setItem errors gracefully', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage full');
    });

    const { result } = renderHook(() => useLocalStorageString(key, defaultValue));

    act(() => {
      result.current[1]('new value');
    });

    expect(result.current[0]).toBe('new value');

    setItemSpy.mockRestore();
  });
});
