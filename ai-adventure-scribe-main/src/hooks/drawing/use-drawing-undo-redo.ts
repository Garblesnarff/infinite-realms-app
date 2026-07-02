/**
 * Drawing undo/redo stack management.
 *
 * @module hooks/drawing/use-drawing-undo-redo
 */

import { useState, useCallback } from 'react';

import type { SceneDrawing } from '@/types/drawing';

import logger from '@/lib/logger';

export interface UseDrawingUndoRedoOptions {
  saveDrawing: (drawing: Partial<SceneDrawing>) => Promise<SceneDrawing | null>;
  deleteDrawing: (drawingId: string) => Promise<void>;
}

export interface UseDrawingUndoRedoReturn {
  recordDrawing: (drawing: SceneDrawing) => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  canUndo: boolean;
  canRedo: boolean;
}

export function useDrawingUndoRedo({
  saveDrawing,
  deleteDrawing,
}: UseDrawingUndoRedoOptions): UseDrawingUndoRedoReturn {
  const [undoStack, setUndoStack] = useState<SceneDrawing[]>([]);
  const [redoStack, setRedoStack] = useState<SceneDrawing[]>([]);

  const recordDrawing = useCallback((drawing: SceneDrawing) => {
    setUndoStack((prev) => [...prev, drawing]);
    setRedoStack([]); // Clear redo stack on new action
  }, []);

  const undo = useCallback(async () => {
    if (undoStack.length === 0) return;

    const lastDrawing = undoStack[undoStack.length - 1];

    try {
      // Delete the drawing
      await deleteDrawing(lastDrawing.id);

      // Move from undo to redo stack
      setUndoStack((prev) => prev.slice(0, -1));
      setRedoStack((prev) => [...prev, lastDrawing]);
    } catch (error) {
      logger.error('Failed to undo drawing', { error });
    }
  }, [undoStack, deleteDrawing]);

  const redo = useCallback(async () => {
    if (redoStack.length === 0) return;

    const drawingToRedo = redoStack[redoStack.length - 1];

    try {
      // Recreate the drawing
      const savedDrawing = await saveDrawing(drawingToRedo);

      if (savedDrawing) {
        // Move from redo to undo stack
        setRedoStack((prev) => prev.slice(0, -1));
        setUndoStack((prev) => [...prev, savedDrawing]);
      }
    } catch (error) {
      logger.error('Failed to redo drawing', { error });
    }
  }, [redoStack, saveDrawing]);

  return {
    recordDrawing,
    undo,
    redo,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
  };
}
