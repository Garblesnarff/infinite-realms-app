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

import { useState, useCallback, useMemo } from 'react';

import { useDrawingPersistence } from './drawing/use-drawing-persistence';
import { useDrawingToolKeyboardShortcuts } from './drawing/use-drawing-tool-keyboard-shortcuts';
import { useDrawingUndoRedo } from './drawing/use-drawing-undo-redo';

import type { SceneDrawing, StrokeConfig, FillConfig, DrawingType } from '@/types/drawing';
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

  // Persistence logic
  const { saveDrawing, deleteDrawing } = useDrawingPersistence({
    sceneId,
    onDrawingDeleted,
  });

  // Undo/Redo
  const { recordDrawing, undo, redo, canUndo, canRedo } = useDrawingUndoRedo({
    saveDrawing,
    deleteDrawing,
  });

  // ===========================
  // Tool Selection
  // ===========================

  const setActiveTool = useCallback((tool: DrawingType | null) => setState((p) => ({ ...p, activeTool: tool, currentDrawing: null })), []);

  // ===========================
  // Drawing Management
  // ===========================

  const startDrawing = useCallback(
    (point: Point2D) => {
      const { activeTool, strokeColor, strokeWidth, fillColor, fillOpacity, fillEnabled } = state;
      if (!activeTool) return;

      const stroke: StrokeConfig = { width: strokeWidth, color: strokeColor, alpha: 1.0, style: 'solid' };
      const fill: FillConfig = { type: fillEnabled ? FillType.SOLID : FillType.NONE, color: fillColor, alpha: fillOpacity };

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

      setState((p) => ({ ...p, currentDrawing: newDrawing }));
    },
    [state, sceneId, userId],
  );

  const updateDrawing = useCallback((data: Partial<SceneDrawing>) => {
    setState((p) => ({ ...p, currentDrawing: p.currentDrawing ? { ...p.currentDrawing, ...data } : null }));
  }, []);

  const finishDrawing = useCallback(async () => {
    const { currentDrawing } = state;
    if (!currentDrawing) return;

    try {
      const savedDrawing = await saveDrawing(currentDrawing);
      if (savedDrawing) {
        recordDrawing(savedDrawing);
        if (onDrawingCreated) onDrawingCreated(savedDrawing);
      }
      setState((p) => ({ ...p, currentDrawing: null }));
    } catch (error) {
      logger.error('Failed to finish drawing', { error });
    }
  }, [state, onDrawingCreated, saveDrawing, recordDrawing]);

  const cancelDrawing = useCallback(() => setState((p) => ({ ...p, currentDrawing: null })), []);

  // ===========================
  // Settings
  // ===========================

  const setStrokeColor = useCallback((color: string) => setState((p) => ({ ...p, strokeColor: color })), []);
  const setStrokeWidth = useCallback((width: number) => setState((p) => ({ ...p, strokeWidth: width })), []);
  const setFillColor = useCallback((color: string) => setState((p) => ({ ...p, fillColor: color })), []);
  const setFillOpacity = useCallback((opacity: number) => setState((p) => ({ ...p, fillOpacity: opacity })), []);
  const setFillEnabled = useCallback((enabled: boolean) => setState((p) => ({ ...p, fillEnabled: enabled })), []);
  const setFontSize = useCallback((size: 'small' | 'medium' | 'large') => setState((p) => ({ ...p, fontSize: size })), []);
  const setTextColor = useCallback((color: string) => setState((p) => ({ ...p, textColor: color })), []);
  const setSelectedLayer = useCallback((layer: string) => setState((p) => ({ ...p, selectedLayer: layer })), []);

  // ===========================
  // Keyboard Shortcuts
  // ===========================

  useDrawingToolKeyboardShortcuts({
    undo,
    redo,
    cancelDrawing,
    hasCurrentDrawing: state.currentDrawing !== null,
  });

  // ===========================
  // Return Values & Memoization
  // ===========================

  // ⚡ Bolt: Memoize the returned object to ensure reference and callback stability.
  // This avoids redundant canvas component re-renders during active gameplay drawing actions.
  const isDrawing = state.currentDrawing !== null;

  return useMemo(
    () => ({
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
      canUndo,
      canRedo,
      saveDrawing,
      deleteDrawing,
      isDrawing,
    }),
    [
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
      canUndo,
      canRedo,
      saveDrawing,
      deleteDrawing,
      isDrawing,
    ],
  );
}
