/**
 * Token Drag Hook - Handles token dragging with grid snapping, movement validation, and optimistic updates.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { SceneSettings } from '@/types/scene';
import type { Token } from '@/types/token';

import { useBattleMapStore } from '@/stores/useBattleMapStore';

export interface Point2D { x: number; y: number; }

export interface DragState {
  isDragging: boolean;
  startPosition: Point2D | null;
  currentPosition: Point2D | null;
  snappedPosition: Point2D | null;
  isValidDrop: boolean;
}

export interface UseTokenDragOptions {
  token: Token;
  sceneSettings: SceneSettings;
  onDragStart?: (tokenId: string, position: Point2D) => void;
  onDragMove?: (tokenId: string, position: Point2D) => void;
  onDragEnd?: (tokenId: string, position: Point2D) => void;
  validateMovement?: (from: Point2D, to: Point2D, distance: number) => boolean;
  gridSize?: number;
}

export interface UseTokenDragReturn {
  dragState: DragState;
  handlePointerDown: (event: PointerEvent | React.PointerEvent) => void;
  handlePointerMove: (event: PointerEvent | React.PointerEvent) => void;
  handlePointerUp: (event: PointerEvent | React.PointerEvent) => void;
  cancelDrag: () => void;
}

function snapToGrid(position: Point2D, gridSize: number): Point2D {
  return { x: Math.round(position.x / gridSize) * gridSize, y: Math.round(position.y / gridSize) * gridSize };
}

function calculateDistance(from: Point2D, to: Point2D): number {
  const dx = to.x - from.x, dy = to.y - from.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function pixelsToGridUnits(pixels: number, gridSize: number, gridDistance: number): number {
  return (pixels / gridSize) * gridDistance;
}

export function useTokenDrag(options: UseTokenDragOptions): UseTokenDragReturn {
  const {
    token, sceneSettings, onDragStart, onDragMove, onDragEnd, validateMovement,
    gridSize = sceneSettings.gridSize,
  } = options;

  const setDraggedToken = useBattleMapStore((state) => state.setDraggedToken);
  const [dragState, setDragState] = useState<DragState>({
    isDragging: false, startPosition: null, currentPosition: null, snappedPosition: null, isValidDrop: true,
  });

  const dragStartRef = useRef<Point2D | null>(null);
  const isDraggingRef = useRef(false);
  const dragThreshold = 5;

  const validateDrop = useCallback(
    (from: Point2D, to: Point2D): boolean => {
      if (validateMovement) {
        const distancePixels = calculateDistance(from, to);
        const distanceUnits = pixelsToGridUnits(distancePixels, gridSize, sceneSettings.gridDistance);
        return validateMovement(from, to, distanceUnits);
      }
      return true;
    },
    [validateMovement, gridSize, sceneSettings.gridDistance],
  );

  const handlePointerDown = useCallback((event: PointerEvent | React.PointerEvent) => {
    if ('button' in event && event.button !== 0) return;
    const target = event.target as HTMLElement;
    target.setPointerCapture?.(event.pointerId);
    dragStartRef.current = { x: event.clientX, y: event.clientY };
  }, []);

  const handlePointerMove = useCallback(
    (event: PointerEvent | React.PointerEvent) => {
      if (!dragStartRef.current) return;
      const currentPos = { x: event.clientX, y: event.clientY };

      if (!isDraggingRef.current) {
        const distance = calculateDistance(dragStartRef.current, currentPos);
        if (distance > dragThreshold) {
          isDraggingRef.current = true;
          setDraggedToken(token.id);
          const startPosition = { x: token.x, y: token.y };
          setDragState({ isDragging: true, startPosition, currentPosition: startPosition, snappedPosition: startPosition, isValidDrop: true });
          if (onDragStart) onDragStart(token.id, startPosition);
        }
        return;
      }

      const deltaX = currentPos.x - dragStartRef.current.x;
      const deltaY = currentPos.y - dragStartRef.current.y;
      const newPosition = { x: token.x + deltaX, y: token.y + deltaY };
      const snapped = snapToGrid(newPosition, gridSize);
      const isValid = validateDrop({ x: token.x, y: token.y }, snapped);

      setDragState((prev) => ({ ...prev, currentPosition: newPosition, snappedPosition: snapped, isValidDrop: isValid }));
      if (onDragMove) onDragMove(token.id, snapped);
    },
    [token, gridSize, validateDrop, onDragStart, onDragMove, setDraggedToken],
  );

  const handlePointerUp = useCallback(
    (event: PointerEvent | React.PointerEvent) => {
      const target = event.target as HTMLElement;
      target.releasePointerCapture?.(event.pointerId);

      if (isDraggingRef.current && dragState.snappedPosition && dragState.isValidDrop) {
        if (onDragEnd) onDragEnd(token.id, dragState.snappedPosition);
      }

      dragStartRef.current = null;
      isDraggingRef.current = false;
      setDraggedToken(null);
      setDragState({ isDragging: false, startPosition: null, currentPosition: null, snappedPosition: null, isValidDrop: true });
    },
    [dragState, token.id, onDragEnd, setDraggedToken],
  );

  const cancelDrag = useCallback(() => {
    dragStartRef.current = null;
    isDraggingRef.current = false;
    setDraggedToken(null);
    setDragState({ isDragging: false, startPosition: null, currentPosition: null, snappedPosition: null, isValidDrop: true });
  }, [setDraggedToken]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && isDraggingRef.current) cancelDrag();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cancelDrag]);

  // ⚡ Bolt: Wrap return value in useMemo to guarantee referential identity stability.
  // This prevents downstream components and rendering contexts from triggering
  // unnecessary virtual DOM reconciliations and component re-renders.
  return useMemo(() => ({
    dragState, handlePointerDown, handlePointerMove, handlePointerUp, cancelDrag,
  }), [dragState, handlePointerDown, handlePointerMove, handlePointerUp, cancelDrag]);
}

export interface UseTokenDragWithMutationOptions extends UseTokenDragOptions {
  onMutationSuccess?: (token: Token) => void;
  onMutationError?: (error: Error) => void;
}

export function useTokenDragWithMutation(options: UseTokenDragWithMutationOptions): UseTokenDragReturn {
  const { onMutationSuccess: _onMutationSuccess, onMutationError: _onMutationError, ...dragOptions } = options;

  const handleDragEnd = useCallback(
    (tokenId: string, position: Point2D) => {
      if (dragOptions.onDragEnd) dragOptions.onDragEnd(tokenId, position);
    },
    [dragOptions],
  );

  return useTokenDrag({ ...dragOptions, onDragEnd: handleDragEnd });
}
