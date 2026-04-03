/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies BEFORE importing the module under test
vi.mock('@/stores/useBattleMapStore', () => ({
  useBattleMapStore: vi.fn(),
}));

import { useTokenDrag } from '../use-token-drag';

import { useBattleMapStore } from '@/stores/useBattleMapStore';

describe('useTokenDrag', () => {
  const mockSetDraggedToken = vi.fn();
  const mockToken = { id: 'token-1', x: 100, y: 100 };
  const mockSceneSettings = { gridSize: 50, gridDistance: 5 };
  const mockOnDragStart = vi.fn();
  const mockOnDragMove = vi.fn();
  const mockOnDragEnd = vi.fn();
  const mockValidateMovement = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(useBattleMapStore).mockImplementation((selector: any) => {
      const state = {
        setDraggedToken: mockSetDraggedToken,
      };
      return selector(state);
    });

    mockValidateMovement.mockReturnValue(true);
  });

  it('should initialize with default state', () => {
    const { result } = renderHook(() =>
      useTokenDrag({
        token: mockToken as any,
        sceneSettings: mockSceneSettings as any,
      }),
    );

    expect(result.current.dragState).toEqual({
      isDragging: false,
      startPosition: null,
      currentPosition: null,
      snappedPosition: null,
      isValidDrop: true,
    });
  });

  it('should start dragging after threshold is exceeded', () => {
    const { result } = renderHook(() =>
      useTokenDrag({
        token: mockToken as any,
        sceneSettings: mockSceneSettings as any,
        onDragStart: mockOnDragStart,
      }),
    );

    const eventDown = { clientX: 100, clientY: 100, button: 0, target: { setPointerCapture: vi.fn() } };
    act(() => {
      result.current.handlePointerDown(eventDown as any);
    });

    // Move just a bit (below threshold)
    const eventMoveSmall = { clientX: 102, clientY: 102 };
    act(() => {
      result.current.handlePointerMove(eventMoveSmall as any);
    });
    expect(result.current.dragState.isDragging).toBe(false);

    // Move past threshold (5px)
    const eventMoveLarge = { clientX: 110, clientY: 110 };
    act(() => {
      result.current.handlePointerMove(eventMoveLarge as any);
    });

    expect(result.current.dragState.isDragging).toBe(true);
    expect(result.current.dragState.startPosition).toEqual({ x: 100, y: 100 });
    expect(mockSetDraggedToken).toHaveBeenCalledWith('token-1');
    expect(mockOnDragStart).toHaveBeenCalledWith('token-1', { x: 100, y: 100 });
  });

  it('should update position and snap to grid during drag', () => {
    const { result } = renderHook(() =>
      useTokenDrag({
        token: mockToken as any,
        sceneSettings: mockSceneSettings as any,
        onDragMove: mockOnDragMove,
      }),
    );

    // Start drag
    act(() => {
      result.current.handlePointerDown({ clientX: 100, clientY: 100, button: 0, target: {} } as any);
      result.current.handlePointerMove({ clientX: 110, clientY: 110 } as any); // Exceed threshold
    });

    // Move more to actually trigger position update
    act(() => {
      result.current.handlePointerMove({ clientX: 160, clientY: 170 } as any);
    });

    // deltaX = 60, deltaY = 70
    // newX = 100 + 60 = 160, newY = 100 + 70 = 170
    // snapped to 50: x=150, y=150
    expect(result.current.dragState.currentPosition).toEqual({ x: 160, y: 170 });
    expect(result.current.dragState.snappedPosition).toEqual({ x: 150, y: 150 });
    expect(mockOnDragMove).toHaveBeenCalledWith('token-1', { x: 150, y: 150 });
  });

  it('should validate movement during drag', () => {
    const { result } = renderHook(() =>
      useTokenDrag({
        token: mockToken as any,
        sceneSettings: mockSceneSettings as any,
        validateMovement: mockValidateMovement,
      }),
    );

    mockValidateMovement.mockReturnValue(false);

    // Start drag
    act(() => {
      result.current.handlePointerDown({ clientX: 100, clientY: 100, button: 0, target: {} } as any);
      result.current.handlePointerMove({ clientX: 110, clientY: 110 } as any); // Exceed threshold
    });

    // Second move to trigger validation
    act(() => {
      result.current.handlePointerMove({ clientX: 160, clientY: 160 } as any);
    });

    expect(result.current.dragState.isValidDrop).toBe(false);
    expect(mockValidateMovement).toHaveBeenCalled();
  });

  it('should complete drag on pointer up', () => {
    const { result } = renderHook(() =>
      useTokenDrag({
        token: mockToken as any,
        sceneSettings: mockSceneSettings as any,
        onDragEnd: mockOnDragEnd,
      }),
    );

    // Start and move
    act(() => {
      result.current.handlePointerDown({ clientX: 100, clientY: 100, button: 0, target: {} } as any);
      result.current.handlePointerMove({ clientX: 110, clientY: 110 } as any); // Start drag
      result.current.handlePointerMove({ clientX: 160, clientY: 160 } as any); // Update position
    });

    // End drag
    act(() => {
      result.current.handlePointerUp({ clientX: 160, clientY: 160, target: { releasePointerCapture: vi.fn() } } as any);
    });

    expect(mockOnDragEnd).toHaveBeenCalledWith('token-1', { x: 150, y: 150 });
    expect(result.current.dragState.isDragging).toBe(false);
    expect(mockSetDraggedToken).toHaveBeenCalledWith(null);
  });

  it('should cancel drag on ESC key', () => {
    const { result } = renderHook(() =>
      useTokenDrag({
        token: mockToken as any,
        sceneSettings: mockSceneSettings as any,
      }),
    );

    // Start drag
    act(() => {
      result.current.handlePointerDown({ clientX: 100, clientY: 100, button: 0, target: {} } as any);
      result.current.handlePointerMove({ clientX: 110, clientY: 110 } as any);
    });

    expect(result.current.dragState.isDragging).toBe(true);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(result.current.dragState.isDragging).toBe(false);
    expect(mockSetDraggedToken).toHaveBeenCalledWith(null);
  });

  it('should not start drag with right mouse button', () => {
    const { result } = renderHook(() =>
      useTokenDrag({
        token: mockToken as any,
        sceneSettings: mockSceneSettings as any,
      }),
    );

    act(() => {
      result.current.handlePointerDown({ clientX: 100, clientY: 100, button: 2 } as any);
    });

    act(() => {
      result.current.handlePointerMove({ clientX: 110, clientY: 110 } as any);
    });

    expect(result.current.dragState.isDragging).toBe(false);
  });
});
