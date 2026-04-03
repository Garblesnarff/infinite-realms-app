import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useIsMobile } from '../use-mobile';

describe('useIsMobile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return true when screen width is mobile', () => {
    // Mock matchMedia to return matches: true
    window.matchMedia = vi.fn().mockImplementation(query => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('should return false when screen width is desktop', () => {
    // Mock matchMedia to return matches: false
    window.matchMedia = vi.fn().mockImplementation(query => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it('should update state when media query changes', () => {
    let changeHandler: (() => void) | null = null;
    let matches = false;

    window.matchMedia = vi.fn().mockImplementation(query => ({
      get matches() { return matches; },
      media: query,
      onchange: null,
      addEventListener: vi.fn((event, handler) => {
        if (event === 'change') changeHandler = handler;
      }),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    // Simulate change to mobile
    act(() => {
      matches = true;
      if (changeHandler) changeHandler();
    });

    expect(result.current).toBe(true);

    // Simulate change back to desktop
    act(() => {
      matches = false;
      if (changeHandler) changeHandler();
    });

    expect(result.current).toBe(false);
  });
});
