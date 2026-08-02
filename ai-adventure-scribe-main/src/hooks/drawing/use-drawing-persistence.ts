import { useCallback, useMemo } from 'react';

import type { SceneDrawing, CreateDrawingData } from '@/types/drawing';

import { trpc } from '@/infrastructure/api';
import logger from '@/lib/logger';

export interface UseDrawingPersistenceOptions {
  sceneId: string;
  onDrawingDeleted?: (drawingId: string) => void;
}

/**
 * Hook for handling drawing persistence logic.
 * Extracted from useDrawingTool to separate database concerns.
 */
export function useDrawingPersistence(options: UseDrawingPersistenceOptions) {
  const { sceneId, onDrawingDeleted } = options;

  // tRPC mutations
  const createDrawingMutation = trpc.drawings?.create.useMutation();
  const deleteDrawingMutation = trpc.drawings?.delete.useMutation();

  const saveDrawing = useCallback(
    async (drawing: Partial<SceneDrawing>): Promise<SceneDrawing | null> => {
      try {
        if (!createDrawingMutation) {
          logger.warn('Drawing API not available');
          return null;
        }

        const drawingData: CreateDrawingData = {
          sceneId: drawing.sceneId || sceneId,
          drawingType: drawing.drawingType!,
          x: drawing.x || 0,
          y: drawing.y || 0,
          width: drawing.width,
          height: drawing.height,
          radius: drawing.radius,
          points: drawing.points,
          stroke: drawing.stroke,
          fill: drawing.fill,
          text: drawing.text,
          gmOnly: drawing.gmOnly || false,
          label: drawing.label,
        };

        const result = await createDrawingMutation.mutateAsync(drawingData);
        logger.info('Drawing saved', { drawingId: result.id });

        return result as SceneDrawing;
      } catch (error) {
        logger.error('Failed to save drawing', { error });
        return null;
      }
    },
    [sceneId, createDrawingMutation],
  );

  const deleteDrawing = useCallback(
    async (drawingId: string): Promise<void> => {
      try {
        if (!deleteDrawingMutation) {
          logger.warn('Drawing API not available');
          return;
        }

        await deleteDrawingMutation.mutateAsync({ drawingId });
        logger.info('Drawing deleted', { drawingId });

        if (onDrawingDeleted) {
          onDrawingDeleted(drawingId);
        }
      } catch (error) {
        logger.error('Failed to delete drawing', { error });
      }
    },
    [deleteDrawingMutation, onDrawingDeleted],
  );

  // ⚡ Bolt: Wrap the return value in useMemo to guarantee referential stability
  // across render cycles and avoid downstream Virtual DOM reconciliations.
  return useMemo(
    () => ({
      saveDrawing,
      deleteDrawing,
    }),
    [saveDrawing, deleteDrawing],
  );
}
