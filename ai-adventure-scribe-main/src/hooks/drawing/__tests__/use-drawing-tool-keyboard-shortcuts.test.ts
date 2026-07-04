import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useDrawingToolKeyboardShortcuts } from '../use-drawing-tool-keyboard-shortcuts';

describe('useDrawingToolKeyboardShortcuts', () => {
  const mockUndo = vi.fn();
  const mockRedo = vi.fn();
  const mockCancelDrawing = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call undo on Ctrl+Z', () => {
    renderHook(() =>
      useDrawingToolKeyboardShortcuts({
        undo: mockUndo,
        redo: mockRedo,
        cancelDrawing: mockCancelDrawing,
        hasCurrentDrawing: false,
      })
    );

    const event = new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      shiftKey: false,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(mockUndo).toHaveBeenCalled();
  });

  it('should call redo on Ctrl+Shift+Z', () => {
    renderHook(() =>
      useDrawingToolKeyboardShortcuts({
        undo: mockUndo,
        redo: mockRedo,
        cancelDrawing: mockCancelDrawing,
        hasCurrentDrawing: false,
      })
    );

    const event = new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(mockRedo).toHaveBeenCalled();
  });

  it('should call redo on Ctrl+Y', () => {
    renderHook(() =>
      useDrawingToolKeyboardShortcuts({
        undo: mockUndo,
        redo: mockRedo,
        cancelDrawing: mockCancelDrawing,
        hasCurrentDrawing: false,
      })
    );

    const event = new KeyboardEvent('keydown', {
      key: 'y',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(mockRedo).toHaveBeenCalled();
  });

  it('should call cancelDrawing on Escape when hasCurrentDrawing is true', () => {
    renderHook(() =>
      useDrawingToolKeyboardShortcuts({
        undo: mockUndo,
        redo: mockRedo,
        cancelDrawing: mockCancelDrawing,
        hasCurrentDrawing: true,
      })
    );

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(mockCancelDrawing).toHaveBeenCalled();
  });

  it('should NOT call cancelDrawing on Escape when hasCurrentDrawing is false', () => {
    renderHook(() =>
      useDrawingToolKeyboardShortcuts({
        undo: mockUndo,
        redo: mockRedo,
        cancelDrawing: mockCancelDrawing,
        hasCurrentDrawing: false,
      })
    );

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(mockCancelDrawing).not.toHaveBeenCalled();
  });

  it('should prevent default on handled keys', () => {
    renderHook(() =>
      useDrawingToolKeyboardShortcuts({
        undo: mockUndo,
        redo: mockRedo,
        cancelDrawing: mockCancelDrawing,
        hasCurrentDrawing: true,
      })
    );

    const event = new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
    window.dispatchEvent(event);

    expect(preventDefaultSpy).toHaveBeenCalled();
  });
});
