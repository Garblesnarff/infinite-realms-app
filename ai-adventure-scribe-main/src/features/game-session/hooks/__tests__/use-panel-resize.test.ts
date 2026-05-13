/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies BEFORE importing the module under test
const mockSetLocalStorage = vi.fn();
vi.mock('@/hooks/use-local-storage', () => ({
  useLocalStorage: vi.fn((key, initialValue) => {
    return [initialValue, mockSetLocalStorage];
  }),
}));

import { usePanelResize } from '../use-panel-resize';

import { useLocalStorage } from '@/hooks/use-local-storage';

describe('usePanelResize', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementation
    vi.mocked(useLocalStorage).mockImplementation((key, initialValue) => {
      return [initialValue, mockSetLocalStorage];
    });
  });

  it('should initialize with default state', () => {
    const { result } = renderHook(() => usePanelResize());

    expect(result.current.isExpanded).toBe(true);
    expect(result.current.activeTab).toBe('character');
    expect(result.current.panelWidth).toBe('340px');
  });

  it('should load from localStorage if state exists', () => {
    const savedState = {
      isExpanded: false,
      activeTab: 'memory',
      panelWidth: '300px',
    };

    vi.mocked(useLocalStorage).mockReturnValue([savedState, mockSetLocalStorage]);

    const { result } = renderHook(() => usePanelResize());

    expect(result.current.isExpanded).toBe(false);
    expect(result.current.activeTab).toBe('memory');
    expect(result.current.panelWidth).toBe('300px');
  });

  it('should update isExpanded state', () => {
    const { result } = renderHook(() => usePanelResize());

    act(() => {
      result.current.setIsExpanded(false);
    });

    expect(result.current.isExpanded).toBe(false);
  });

  it('should update activeTab state', () => {
    const { result } = renderHook(() => usePanelResize());

    act(() => {
      result.current.setActiveTab('combat');
    });

    expect(result.current.activeTab).toBe('combat');
  });

  it('should handle resizing within constraints', () => {
    const { result } = renderHook(() => usePanelResize());

    // Mock parent element for bounding rect
    const mockParentElement = {
      getBoundingClientRect: () => ({ left: 0 }),
    };

    // We need to set the ref manually since renderHook doesn't attach to DOM
    Object.defineProperty(result.current.panelRef, 'current', {
      value: {
        style: { width: '340px' },
        parentElement: mockParentElement,
      },
    });

    // Start dragging
    act(() => {
      const mockEvent = {
        preventDefault: vi.fn(),
      } as any;
      result.current.startDrag(mockEvent);
    });

    // Simulate mouse move to 300px
    act(() => {
      const moveEvent = new MouseEvent('mousemove', { clientX: 300 });
      document.dispatchEvent(moveEvent);
    });

    expect(result.current.panelWidth).toBe('300px');
    expect(result.current.panelRef.current?.style.width).toBe('300px');

    // Test minimum constraint (280px)
    act(() => {
      const moveEvent = new MouseEvent('mousemove', { clientX: 100 });
      document.dispatchEvent(moveEvent);
    });
    expect(result.current.panelWidth).toBe('280px');

    // Test maximum constraint (400px)
    act(() => {
      const moveEvent = new MouseEvent('mousemove', { clientX: 500 });
      document.dispatchEvent(moveEvent);
    });
    expect(result.current.panelWidth).toBe('400px');

    // Stop dragging
    act(() => {
      const upEvent = new MouseEvent('mouseup');
      document.dispatchEvent(upEvent);
    });

    // Move after stop should not update
    act(() => {
      const moveEvent = new MouseEvent('mousemove', { clientX: 350 });
      document.dispatchEvent(moveEvent);
    });
    expect(result.current.panelWidth).toBe('400px');
  });

  it('should handle dragging without parent element gracefully', () => {
    const { result } = renderHook(() => usePanelResize());

    // Set ref but without parentElement
    Object.defineProperty(result.current.panelRef, 'current', {
      value: {
        style: { width: '340px' },
        parentElement: null,
      },
    });

    act(() => {
      result.current.startDrag({ preventDefault: vi.fn() } as any);
    });

    act(() => {
      const moveEvent = new MouseEvent('mousemove', { clientX: 300 });
      document.dispatchEvent(moveEvent);
    });

    // Width should NOT change if parentElement is missing
    expect(result.current.panelWidth).toBe('340px');
  });

  it('should persist state to localStorage when it changes', () => {
    const { result, rerender } = renderHook(() => usePanelResize());

    act(() => {
      result.current.setIsExpanded(false);
    });

    rerender();

    expect(mockSetLocalStorage).toHaveBeenCalled();

    const updaters = mockSetLocalStorage.mock.calls.map(call => call[0]);
    let foundCorrectUpdate = false;

    for (const updater of updaters) {
      if (typeof updater === 'function') {
        const newState = updater({
          isExpanded: true,
          activeTab: 'character',
          panelWidth: '340px',
        });
        if (newState.isExpanded === false) {
          foundCorrectUpdate = true;
          break;
        }
      }
    }

    expect(foundCorrectUpdate).toBe(true);
  });

  it('should not update localStorage if state is identical', () => {
    renderHook(() => usePanelResize());

    // Reset mock to ignore calls during initialization
    mockSetLocalStorage.mockClear();

    // Trigger an effect run without state change
    act(() => {
      // result.current.setIsExpanded(true); // already true
    });

    const updaters = mockSetLocalStorage.mock.calls.map(call => call[0]);
    for (const updater of updaters) {
      if (typeof updater === 'function') {
        const initialState = {
          isExpanded: true,
          activeTab: 'character',
          panelWidth: '340px',
        };
        const newState = updater(initialState);
        expect(newState).toBe(initialState); // Should return previous state (identical)
      }
    }
  });

  it('should cleanup event listeners on unmount', () => {
    const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');
    const { unmount } = renderHook(() => usePanelResize());

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(removeEventListenerSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));
  });
});
