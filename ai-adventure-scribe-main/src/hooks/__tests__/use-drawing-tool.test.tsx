/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useDrawingTool } from '../use-drawing-tool';

import { trpc } from '@/infrastructure/api';
import { DrawingType } from '@/types/drawing';

// Mock tRPC
const mockCreateMutation = {
  mutateAsync: vi.fn(),
};
const mockUpdateMutation = {
  mutateAsync: vi.fn(),
};
const mockDeleteMutation = {
  mutateAsync: vi.fn(),
};

vi.mock('@/infrastructure/api', () => ({
  trpc: {
    drawings: {
      create: {
        useMutation: vi.fn(),
      },
      update: {
        useMutation: vi.fn(),
      },
      delete: {
        useMutation: vi.fn(),
      },
    },
  },
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }
}));

describe('useDrawingTool', () => {
  const sceneId = 'scene-123';
  const userId = 'user-456';

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementations
    (trpc.drawings?.create.useMutation as any).mockReturnValue(mockCreateMutation);
    (trpc.drawings?.update.useMutation as any).mockReturnValue(mockUpdateMutation);
    (trpc.drawings?.delete.useMutation as any).mockReturnValue(mockDeleteMutation);
  });

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useDrawingTool({ sceneId, userId }));

    expect(result.current.state.activeTool).toBeNull();
    expect(result.current.state.strokeColor).toBe('#000000');
    expect(result.current.state.strokeWidth).toBe(2);
    expect(result.current.isDrawing).toBe(false);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it('should set active tool', () => {
    const { result } = renderHook(() => useDrawingTool({ sceneId, userId }));

    act(() => {
      result.current.setActiveTool(DrawingType.FREEHAND);
    });

    expect(result.current.state.activeTool).toBe(DrawingType.FREEHAND);
  });

  it('should update settings', () => {
    const { result } = renderHook(() => useDrawingTool({ sceneId, userId }));

    act(() => {
      result.current.setStrokeColor('#ff0000');
      result.current.setStrokeWidth(5);
      result.current.setFillColor('#00ff00');
      result.current.setFillOpacity(0.8);
      result.current.setFillEnabled(true);
      result.current.setFontSize('large');
      result.current.setTextColor('#0000ff');
      result.current.setSelectedLayer('foreground');
    });

    expect(result.current.state.strokeColor).toBe('#ff0000');
    expect(result.current.state.strokeWidth).toBe(5);
    expect(result.current.state.fillColor).toBe('#00ff00');
    expect(result.current.state.fillOpacity).toBe(0.8);
    expect(result.current.state.fillEnabled).toBe(true);
    expect(result.current.state.fontSize).toBe('large');
    expect(result.current.state.textColor).toBe('#0000ff');
    expect(result.current.state.selectedLayer).toBe('foreground');
  });

  it('should handle drawing lifecycle', async () => {
    const onDrawingCreated = vi.fn();
    const { result } = renderHook(() => useDrawingTool({ sceneId, userId, onDrawingCreated }));
    const mockDrawing = { id: 'drawing-1', sceneId, drawingType: DrawingType.FREEHAND };
    mockCreateMutation.mutateAsync.mockResolvedValue(mockDrawing);

    // Start drawing
    act(() => {
      result.current.setActiveTool(DrawingType.FREEHAND);
    });
    act(() => {
      result.current.startDrawing({ x: 10, y: 10 });
    });

    expect(result.current.isDrawing).toBe(true);
    expect(result.current.state.currentDrawing?.x).toBe(10);

    // Update drawing
    act(() => {
      result.current.updateDrawing({ points: [{ x: 10, y: 10 }, { x: 20, y: 20 }] });
    });

    expect(result.current.state.currentDrawing?.points).toHaveLength(2);

    // Finish drawing
    await act(async () => {
      await result.current.finishDrawing();
    });

    expect(result.current.isDrawing).toBe(false);
    expect(mockCreateMutation.mutateAsync).toHaveBeenCalled();
    expect(onDrawingCreated).toHaveBeenCalledWith(mockDrawing);
    expect(result.current.canUndo).toBe(true);
  });

  it('should handle cancel drawing', () => {
    const { result } = renderHook(() => useDrawingTool({ sceneId, userId }));

    act(() => {
      result.current.setActiveTool(DrawingType.FREEHAND);
    });
    act(() => {
      result.current.startDrawing({ x: 10, y: 10 });
    });

    expect(result.current.isDrawing).toBe(true);

    act(() => {
      result.current.cancelDrawing();
    });

    expect(result.current.isDrawing).toBe(false);
    expect(result.current.state.currentDrawing).toBeNull();
  });

  it('should handle undo and redo', async () => {
    const onDrawingDeleted = vi.fn();
    const { result } = renderHook(() => useDrawingTool({ sceneId, userId, onDrawingDeleted }));
    const mockDrawing = { id: 'drawing-1', sceneId, drawingType: DrawingType.FREEHAND };
    mockCreateMutation.mutateAsync.mockResolvedValue(mockDrawing);
    mockDeleteMutation.mutateAsync.mockResolvedValue({ id: 'drawing-1' });

    // Create a drawing
    act(() => {
      result.current.setActiveTool(DrawingType.FREEHAND);
    });
    act(() => {
      result.current.startDrawing({ x: 10, y: 10 });
    });
    await act(async () => {
      await result.current.finishDrawing();
    });

    expect(result.current.canUndo).toBe(true);

    // Undo
    await act(async () => {
      await result.current.undo();
    });

    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
    expect(mockDeleteMutation.mutateAsync).toHaveBeenCalledWith({ drawingId: 'drawing-1' });
    expect(onDrawingDeleted).toHaveBeenCalledWith('drawing-1');

    // Redo
    await act(async () => {
      await result.current.redo();
    });

    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
    expect(mockCreateMutation.mutateAsync).toHaveBeenCalledTimes(2);
  });

  it('should handle keyboard shortcuts', async () => {
    const { result } = renderHook(() => useDrawingTool({ sceneId, userId }));
    const mockDrawing = { id: 'drawing-1', sceneId, drawingType: DrawingType.FREEHAND };
    mockCreateMutation.mutateAsync.mockResolvedValue(mockDrawing);
    mockDeleteMutation.mutateAsync.mockResolvedValue({ id: 'drawing-1' });

    // Test Escape to cancel
    act(() => {
      result.current.setActiveTool(DrawingType.FREEHAND);
    });
    act(() => {
      result.current.startDrawing({ x: 10, y: 10 });
    });

    expect(result.current.isDrawing).toBe(true);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(result.current.isDrawing).toBe(false);

    // Test Ctrl+Z for undo
    await act(async () => {
      result.current.setActiveTool(DrawingType.FREEHAND);
    });
    act(() => {
      result.current.startDrawing({ x: 10, y: 10 });
    });
    await act(async () => {
      await result.current.finishDrawing();
    });
    expect(result.current.canUndo).toBe(true);

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
    });
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);

    // Test Ctrl+Y for redo
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true }));
    });
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);

    // Test Ctrl+Shift+Z for redo
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
    });
    expect(result.current.canRedo).toBe(true);

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true }));
    });
    expect(result.current.canRedo).toBe(false);

    // Test Meta+Z for undo (Mac)
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true }));
    });
    expect(result.current.canRedo).toBe(true);
  });

  it('should handle API errors gracefully', async () => {
    const { result } = renderHook(() => useDrawingTool({ sceneId, userId }));
    mockCreateMutation.mutateAsync.mockRejectedValue(new Error('API Error'));

    act(() => {
      result.current.setActiveTool(DrawingType.FREEHAND);
    });
    act(() => {
      result.current.startDrawing({ x: 10, y: 10 });
    });

    await act(async () => {
      await result.current.finishDrawing();
    });

    expect(result.current.isDrawing).toBe(false);
    expect(result.current.canUndo).toBe(false);
  });

  it('should handle missing mutations', async () => {
    (trpc.drawings?.create.useMutation as any).mockReturnValue(null);
    (trpc.drawings?.delete.useMutation as any).mockReturnValue(null);

    const { result } = renderHook(() => useDrawingTool({ sceneId, userId }));

    act(() => {
      result.current.setActiveTool(DrawingType.FREEHAND);
    });
    act(() => {
      result.current.startDrawing({ x: 10, y: 10 });
    });

    const saved = await result.current.saveDrawing({ sceneId, drawingType: DrawingType.FREEHAND });
    expect(saved).toBeNull();

    await result.current.deleteDrawing('id');
    // Just verifying it doesn't crash
  });

  it('should maintain referential stability on identical renders', () => {
    const { result, rerender } = renderHook(
      ({ sId, uId }) => useDrawingTool({ sceneId: sId, userId: uId }),
      { initialProps: { sId: sceneId, uId: userId } }
    );

    const firstReturn = result.current;

    // Trigger a rerender with identical parameters
    rerender({ sId: sceneId, uId: userId });

    const secondReturn = result.current;

    // The root returned object should be referentially stable
    expect(firstReturn).toBe(secondReturn);

    // Callbacks must be referentially stable
    expect(firstReturn.setActiveTool).toBe(secondReturn.setActiveTool);
    expect(firstReturn.startDrawing).toBe(secondReturn.startDrawing);
    expect(firstReturn.updateDrawing).toBe(secondReturn.updateDrawing);
    expect(firstReturn.finishDrawing).toBe(secondReturn.finishDrawing);
    expect(firstReturn.cancelDrawing).toBe(secondReturn.cancelDrawing);
    expect(firstReturn.setStrokeColor).toBe(secondReturn.setStrokeColor);
    expect(firstReturn.setStrokeWidth).toBe(secondReturn.setStrokeWidth);
    expect(firstReturn.setFillColor).toBe(secondReturn.setFillColor);
    expect(firstReturn.setFillOpacity).toBe(secondReturn.setFillOpacity);
    expect(firstReturn.setFillEnabled).toBe(secondReturn.setFillEnabled);
    expect(firstReturn.setFontSize).toBe(secondReturn.setFontSize);
    expect(firstReturn.setTextColor).toBe(secondReturn.setTextColor);
    expect(firstReturn.setSelectedLayer).toBe(secondReturn.setSelectedLayer);
    expect(firstReturn.undo).toBe(secondReturn.undo);
    expect(firstReturn.redo).toBe(secondReturn.redo);
    expect(firstReturn.saveDrawing).toBe(secondReturn.saveDrawing);
    expect(firstReturn.deleteDrawing).toBe(secondReturn.deleteDrawing);
  });
});
