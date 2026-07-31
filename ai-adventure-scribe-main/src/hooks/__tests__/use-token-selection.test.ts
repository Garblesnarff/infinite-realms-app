/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies BEFORE importing the module under test
vi.mock('@/stores/useBattleMapStore', () => ({
  useBattleMapStore: vi.fn(),
  useSelectedTokenIds: vi.fn(),
}));

import { useTokenSelection } from '../use-token-selection';

import { useBattleMapStore, useSelectedTokenIds } from '@/stores/useBattleMapStore';

describe('useTokenSelection', () => {
  const mockSelectToken = vi.fn();
  const mockDeselectToken = vi.fn();
  const mockToggleSelectToken = vi.fn();
  const mockClearSelection = vi.fn();
  const mockOnSelectionChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(useSelectedTokenIds).mockReturnValue([]);
    vi.mocked(useBattleMapStore).mockImplementation((selector: any) => {
      const state = {
        selectToken: mockSelectToken,
        deselectToken: mockDeselectToken,
        toggleSelectToken: mockToggleSelectToken,
        clearSelection: mockClearSelection,
      };
      return selector(state);
    });
  });

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useTokenSelection());

    expect(result.current.selectedTokenIds).toEqual([]);
    expect(result.current.selectToken).toBe(mockSelectToken);
    expect(result.current.deselectToken).toBe(mockDeselectToken);
    expect(result.current.toggleSelectToken).toBe(mockToggleSelectToken);
    expect(result.current.clearSelection).toBe(mockClearSelection);
  });

  it('should call selectToken on handleTokenClick without modifier', () => {
    const { result } = renderHook(() => useTokenSelection());

    act(() => {
      result.current.handleTokenClick('token-1', { ctrlKey: false, metaKey: false });
    });

    expect(mockSelectToken).toHaveBeenCalledWith('token-1', false);
  });

  it('should call toggleSelectToken on handleTokenClick with ctrlKey', () => {
    const { result } = renderHook(() => useTokenSelection());

    act(() => {
      result.current.handleTokenClick('token-1', { ctrlKey: true });
    });

    expect(mockToggleSelectToken).toHaveBeenCalledWith('token-1');
  });

  it('should call toggleSelectToken on handleTokenClick with metaKey', () => {
    const { result } = renderHook(() => useTokenSelection());

    act(() => {
      result.current.handleTokenClick('token-1', { metaKey: true });
    });

    expect(mockToggleSelectToken).toHaveBeenCalledWith('token-1');
  });

  it('should call clearSelection on handleBackgroundClick', () => {
    const { result } = renderHook(() => useTokenSelection());

    act(() => {
      result.current.handleBackgroundClick();
    });

    expect(mockClearSelection).toHaveBeenCalled();
  });

  it('should check if a token is selected', () => {
    vi.mocked(useSelectedTokenIds).mockReturnValue(['token-1']);
    const { result } = renderHook(() => useTokenSelection());

    expect(result.current.isSelected('token-1')).toBe(true);
    expect(result.current.isSelected('token-2')).toBe(false);
  });

  it('should clear selection on ESC key press', () => {
    vi.mocked(useSelectedTokenIds).mockReturnValue(['token-1']);
    renderHook(() => useTokenSelection());

    const event = new KeyboardEvent('keydown', { key: 'Escape' });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

    act(() => {
      window.dispatchEvent(event);
    });

    expect(mockClearSelection).toHaveBeenCalled();
    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it('should not clear selection on ESC key press if nothing selected', () => {
    vi.mocked(useSelectedTokenIds).mockReturnValue([]);
    renderHook(() => useTokenSelection());

    const event = new KeyboardEvent('keydown', { key: 'Escape' });

    act(() => {
      window.dispatchEvent(event);
    });

    expect(mockClearSelection).not.toHaveBeenCalled();
  });

  it('should not clear selection on ESC if keyboard shortcuts are disabled', () => {
    vi.mocked(useSelectedTokenIds).mockReturnValue(['token-1']);
    renderHook(() => useTokenSelection({ enableKeyboardShortcuts: false }));

    const event = new KeyboardEvent('keydown', { key: 'Escape' });

    act(() => {
      window.dispatchEvent(event);
    });

    expect(mockClearSelection).not.toHaveBeenCalled();
  });

  it('should notify on selection change', () => {
    let selectedIds: string[] = [];
    vi.mocked(useSelectedTokenIds).mockImplementation(() => selectedIds);

    const { rerender } = renderHook(() =>
      useTokenSelection({ onSelectionChange: mockOnSelectionChange }),
    );

    // Initial call
    expect(mockOnSelectionChange).toHaveBeenCalledWith([]);

    // Update selection
    selectedIds = ['token-1'];
    rerender();

    expect(mockOnSelectionChange).toHaveBeenCalledWith(['token-1']);
  });

  it('should maintain referential stability of returned object across re-renders when dependencies do not change', () => {
    const { result, rerender } = renderHook(() => useTokenSelection());

    const firstResult = result.current;
    rerender();
    const secondResult = result.current;

    expect(firstResult).toBe(secondResult);
  });
});
