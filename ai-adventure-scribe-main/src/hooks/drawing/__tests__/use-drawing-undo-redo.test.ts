
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useDrawingUndoRedo } from '../use-drawing-undo-redo';

import type { SceneDrawing } from '@/types/drawing';

import logger from '@/lib/logger';

vi.mock('@/lib/logger', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('useDrawingUndoRedo', () => {
  const mockSaveDrawing = vi.fn();
  const mockDeleteDrawing = vi.fn();

  const mockDrawing1: SceneDrawing = {
    id: 'd1',
    scene_id: 's1',
    user_id: 'u1',
    tool: 'pencil',
    color: '#000000',
    brush_size: 5,
    points: [0, 0, 10, 10],
    created_at: '2023-01-01T00:00:00Z',
  };

  const mockDrawing2: SceneDrawing = {
    id: 'd2',
    scene_id: 's1',
    user_id: 'u1',
    tool: 'eraser',
    color: '#ffffff',
    brush_size: 10,
    points: [20, 20, 30, 30],
    created_at: '2023-01-01T00:00:01Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with empty stacks', () => {
    const { result } = renderHook(() =>
      useDrawingUndoRedo({ saveDrawing: mockSaveDrawing, deleteDrawing: mockDeleteDrawing })
    );

    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it('should update undo stack when recording a drawing', () => {
    const { result } = renderHook(() =>
      useDrawingUndoRedo({ saveDrawing: mockSaveDrawing, deleteDrawing: mockDeleteDrawing })
    );

    act(() => {
      result.current.recordDrawing(mockDrawing1);
    });

    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  it('should clear redo stack when recording a new drawing', async () => {
    mockDeleteDrawing.mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useDrawingUndoRedo({ saveDrawing: mockSaveDrawing, deleteDrawing: mockDeleteDrawing })
    );

    act(() => {
      result.current.recordDrawing(mockDrawing1);
    });

    await act(async () => {
      await result.current.undo();
    });

    expect(result.current.canRedo).toBe(true);

    act(() => {
      result.current.recordDrawing(mockDrawing2);
    });

    expect(result.current.canRedo).toBe(false);
  });

  it('should successfully undo a drawing', async () => {
    mockDeleteDrawing.mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useDrawingUndoRedo({ saveDrawing: mockSaveDrawing, deleteDrawing: mockDeleteDrawing })
    );

    act(() => {
      result.current.recordDrawing(mockDrawing1);
    });

    await act(async () => {
      await result.current.undo();
    });

    expect(mockDeleteDrawing).toHaveBeenCalledWith(mockDrawing1.id);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
  });

  it('should do nothing if undo is called with an empty stack', async () => {
    const { result } = renderHook(() =>
      useDrawingUndoRedo({ saveDrawing: mockSaveDrawing, deleteDrawing: mockDeleteDrawing })
    );

    await act(async () => {
      await result.current.undo();
    });

    expect(mockDeleteDrawing).not.toHaveBeenCalled();
  });

  it('should successfully redo a drawing', async () => {
    mockDeleteDrawing.mockResolvedValue(undefined);
    mockSaveDrawing.mockResolvedValue(mockDrawing1);

    const { result } = renderHook(() =>
      useDrawingUndoRedo({ saveDrawing: mockSaveDrawing, deleteDrawing: mockDeleteDrawing })
    );

    act(() => {
      result.current.recordDrawing(mockDrawing1);
    });

    await act(async () => {
      await result.current.undo();
    });

    await act(async () => {
      await result.current.redo();
    });

    expect(mockSaveDrawing).toHaveBeenCalledWith(mockDrawing1);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  it('should do nothing if redo is called with an empty stack', async () => {
    const { result } = renderHook(() =>
      useDrawingUndoRedo({ saveDrawing: mockSaveDrawing, deleteDrawing: mockDeleteDrawing })
    );

    await act(async () => {
      await result.current.redo();
    });

    expect(mockSaveDrawing).not.toHaveBeenCalled();
  });

  it('should log error if undo fails', async () => {
    const error = new Error('Delete failed');
    mockDeleteDrawing.mockRejectedValue(error);

    const { result } = renderHook(() =>
      useDrawingUndoRedo({ saveDrawing: mockSaveDrawing, deleteDrawing: mockDeleteDrawing })
    );

    act(() => {
      result.current.recordDrawing(mockDrawing1);
    });

    await act(async () => {
      await result.current.undo();
    });

    expect(logger.error).toHaveBeenCalledWith('Failed to undo drawing', { error });
    // Stacks should not change if it fails
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  it('should log error if redo fails', async () => {
    const error = new Error('Save failed');
    mockDeleteDrawing.mockResolvedValue(undefined);
    mockSaveDrawing.mockRejectedValue(error);

    const { result } = renderHook(() =>
      useDrawingUndoRedo({ saveDrawing: mockSaveDrawing, deleteDrawing: mockDeleteDrawing })
    );

    act(() => {
      result.current.recordDrawing(mockDrawing1);
    });

    await act(async () => {
      await result.current.undo();
    });

    await act(async () => {
      await result.current.redo();
    });

    expect(logger.error).toHaveBeenCalledWith('Failed to redo drawing', { error });
    // Stacks should not change if it fails
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
  });
});
