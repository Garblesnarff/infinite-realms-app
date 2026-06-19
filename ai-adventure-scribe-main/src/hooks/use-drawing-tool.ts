/**
 * Drawing Tool Hook
 *
 * Manages drawing tool state including active tool, current drawing,
 * color/width settings, and undo/redo operations.
 *
 * Features:
 * - Multiple drawing tools (freehand, line, shapes, text)
 * - Color and stroke width management
 * - Fill settings
 * - Undo/redo support
 * - Save drawings to database
 * - Delete drawings
 *
 * @module hooks/use-drawing-tool
 */

/* eslint-disable max-lines */
import { useState, useCallback, useEffect } from 'react';

import { useDrawingPersistence } from './drawing/use-drawing-persistence';

import type {
  SceneDrawing,
  StrokeConfig,
  FillConfig,
 DrawingType} from '@/types/drawing';
import type { Point2D } from '@/types/scene';

import logger from '@/lib/logger';
import { FillType } from '@/types/drawing';

// ===========================
// Types
// ===========================

export interface DrawingToolState {
  activeTool: DrawingType | null;
  currentDrawing: Partial<SceneDrawing> | null;
  strokeColor: string;
  strokeWidth: number;
  fillColor: string;
  fillOpacity: number;
  fillEnabled: boolean;
  fontSize: 'small' | 'medium' | 'large';
  textColor: string;
  selectedLayer: string;
}

export interface UseDrawingToolOptions {
  sceneId: string;
  userId?: string;
  onDrawingCreated?: (drawing: SceneDrawing) => void;
  onDrawingDeleted?: (drawingId: string) => void;
}

export interface UseDrawingToolReturn {
  // State
  state: DrawingToolState;

  // Tool selection
  setActiveTool: (tool: DrawingType | null) => void;

  // Drawing management
  startDrawing: (point: Point2D) => void;
  updateDrawing: (data: Partial<SceneDrawing>) => void;
  finishDrawing: () => Promise<void>;
  cancelDrawing: () => void;

  // Settings
  setStrokeColor: (color: string) => void;
  setStrokeWidth: (width: number) => void;
  setFillColor: (color: string) => void;
  setFillOpacity: (opacity: number) => void;
  setFillEnabled: (enabled: boolean) => void;
  setFontSize: (size: 'small' | 'medium' | 'large') => void;
  setTextColor: (color: string) => void;
  setSelectedLayer: (layer: string) => void;

  // Undo/Redo
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;

  // Database operations
  saveDrawing: (drawing: Partial<SceneDrawing>) => Promise<SceneDrawing | null>;
  deleteDrawing: (drawingId: string) => Promise<void>;

  // Current drawing state
  isDrawing: boolean;
}

// ===========================
// Default Values
// ===========================

const DEFAULT_STATE: DrawingToolState = {
  activeTool: null,
  currentDrawing: null,
  strokeColor: '#000000',
  strokeWidth: 2,
  fillColor: '#ffffff',
  fillOpacity: 0.5,
  fillEnabled: false,
  fontSize: 'medium',
  textColor: '#000000',
  selectedLayer: 'drawings',
};


// ===========================
// Hook Implementation
// ===========================

export function useDrawingTool(options: UseDrawingToolOptions): UseDrawingToolReturn {
  const { sceneId, userId, onDrawingCreated, onDrawingDeleted } = options;

  // State
  const [state, setState] = useState<DrawingToolState>(DEFAULT_STATE);

  // Undo/Redo stacks
  const [undoStack, setUndoStack] = useState<SceneDrawing[]>([]);
  const [redoStack, setRedoStack] = useState<SceneDrawing[]>([]);

  // Persistence logic
  const { saveDrawing, deleteDrawing } = useDrawingPersistence({
    sceneId,
    onDrawingDeleted,
  });

  // ===========================
  // Tool Selection
  // ===========================

  const setActiveTool = useCallback((tool: DrawingType | null) => {
    setState((prev) => ({ ...prev, activeTool: tool, currentDrawing: null }));
  }, []);

  // ===========================
  // Drawing Management
  // ===========================

  const startDrawing = useCallback(
    (point: Point2D) => {
      const { activeTool, strokeColor, strokeWidth, fillColor, fillOpacity, fillEnabled } = state;

      if (!activeTool) return;

      const stroke: StrokeConfig = {
        width: strokeWidth,
        color: strokeColor,
        alpha: 1.0,
        style: 'solid',
      };

      const fill: FillConfig = {
        type: fillEnabled ? FillType.SOLID : FillType.NONE,
        color: fillColor,
        alpha: fillOpacity,
      };

      const newDrawing: Partial<SceneDrawing> = {
        sceneId,
        drawingType: activeTool,
        x: point.x,
        y: point.y,
        points: [point],
        stroke,
        fill,
        zIndex: 100,
        locked: false,
        hidden: false,
        authorId: userId || 'unknown',
        gmOnly: false,
      };

      setState((prev) => ({ ...prev, currentDrawing: newDrawing }));
    },
    [state, sceneId, userId],
  );

  const updateDrawing = useCallback((data: Partial<SceneDrawing>) => {
    setState((prev) => ({
      ...prev,
      currentDrawing: prev.currentDrawing ? { ...prev.currentDrawing, ...data } : null,
    }));
  }, []);

  const finishDrawing = useCallback(async () => {
    const { currentDrawing } = state;

    if (!currentDrawing) return;

    try {
      const savedDrawing = await saveDrawing(currentDrawing);

      if (savedDrawing) {
        // Add to undo stack
        setUndoStack((prev) => [...prev, savedDrawing]);
        setRedoStack([]); // Clear redo stack on new action

        if (onDrawingCreated) {
          onDrawingCreated(savedDrawing);
        }
      }

      // Clear current drawing
      setState((prev) => ({ ...prev, currentDrawing: null }));
    } catch (error) {
      logger.error('Failed to finish drawing', { error });
    }
  }, [state, onDrawingCreated, saveDrawing]);

  const cancelDrawing = useCallback(() => {
    setState((prev) => ({ ...prev, currentDrawing: null }));
  }, []);

  // ===========================
  // Settings
  // ===========================

  const setStrokeColor = useCallback((color: string) => {
    setState((prev) => ({ ...prev, strokeColor: color }));
  }, []);

  const setStrokeWidth = useCallback((width: number) => {
    setState((prev) => ({ ...prev, strokeWidth: width }));
  }, []);

  const setFillColor = useCallback((color: string) => {
    setState((prev) => ({ ...prev, fillColor: color }));
  }, []);

  const setFillOpacity = useCallback((opacity: number) => {
    setState((prev) => ({ ...prev, fillOpacity: opacity }));
  }, []);

  const setFillEnabled = useCallback((enabled: boolean) => {
    setState((prev) => ({ ...prev, fillEnabled: enabled }));
  }, []);

  const setFontSize = useCallback((size: 'small' | 'medium' | 'large') => {
    setState((prev) => ({ ...prev, fontSize: size }));
  }, []);

  const setTextColor = useCallback((color: string) => {
    setState((prev) => ({ ...prev, textColor: color }));
  }, []);

  const setSelectedLayer = useCallback((layer: string) => {
    setState((prev) => ({ ...prev, selectedLayer: layer }));
  }, []);

  // ===========================
  // Undo/Redo
  // ===========================

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

  // ===========================
  // Keyboard Shortcuts
  // ===========================

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ctrl/Cmd+Z for undo
      if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      }

      // Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y for redo
      if (
        ((event.ctrlKey || event.metaKey) && event.key === 'z' && event.shiftKey) ||
        ((event.ctrlKey || event.metaKey) && event.key === 'y')
      ) {
        event.preventDefault();
        redo();
      }

      // Escape to cancel current drawing
      if (event.key === 'Escape' && state.currentDrawing) {
        event.preventDefault();
        cancelDrawing();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, cancelDrawing, state.currentDrawing]);

  // ===========================
  // Return Values
  // ===========================

  return {
    state,
    setActiveTool,
    startDrawing,
    updateDrawing,
    finishDrawing,
    cancelDrawing,
    setStrokeColor,
    setStrokeWidth,
    setFillColor,
    setFillOpacity,
    setFillEnabled,
    setFontSize,
    setTextColor,
    setSelectedLayer,
    undo,
    redo,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    saveDrawing,
    deleteDrawing,
    isDrawing: state.currentDrawing !== null,
  };
}
