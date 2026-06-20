/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useDrawingPersistence } from '../use-drawing-persistence';

import { trpc } from '@/infrastructure/api';
import logger from '@/lib/logger';
import { DrawingType } from '@/types/drawing';

// Mock tRPC
const mockCreateMutation = {
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
}));

describe('useDrawingPersistence', () => {
  const sceneId = 'scene-123';

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementations
    (trpc.drawings?.create.useMutation as any).mockReturnValue(mockCreateMutation);
    (trpc.drawings?.delete.useMutation as any).mockReturnValue(mockDeleteMutation);
  });

  describe('saveDrawing', () => {
    it('should successfully save a drawing', async () => {
      const { result } = renderHook(() => useDrawingPersistence({ sceneId }));
      const mockDrawingData = {
        drawingType: DrawingType.FREEHAND,
        x: 10,
        y: 20,
      };
      const mockSavedDrawing = { id: 'drawing-1', ...mockDrawingData, sceneId };
      mockCreateMutation.mutateAsync.mockResolvedValue(mockSavedDrawing);

      const saved = await result.current.saveDrawing(mockDrawingData);

      expect(saved).toEqual(mockSavedDrawing);
      expect(mockCreateMutation.mutateAsync).toHaveBeenCalledWith({
        sceneId,
        drawingType: DrawingType.FREEHAND,
        x: 10,
        y: 20,
        width: undefined,
        height: undefined,
        radius: undefined,
        points: undefined,
        stroke: undefined,
        fill: undefined,
        text: undefined,
        gmOnly: false,
        label: undefined,
      });
      expect(logger.info).toHaveBeenCalledWith('Drawing saved', { drawingId: 'drawing-1' });
    });

    it('should use sceneId from drawing if provided', async () => {
      const { result } = renderHook(() => useDrawingPersistence({ sceneId: 'default-scene' }));
      const mockDrawingData = {
        sceneId: 'other-scene',
        drawingType: DrawingType.CIRCLE,
        x: 0,
        y: 0,
      };
      mockCreateMutation.mutateAsync.mockResolvedValue({ id: 'd2' });

      await result.current.saveDrawing(mockDrawingData);

      expect(mockCreateMutation.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ sceneId: 'other-scene' })
      );
    });

    it('should handle API errors gracefully', async () => {
      const { result } = renderHook(() => useDrawingPersistence({ sceneId }));
      const error = new Error('API Failure');
      mockCreateMutation.mutateAsync.mockRejectedValue(error);

      const saved = await result.current.saveDrawing({ drawingType: DrawingType.LINE });

      expect(saved).toBeNull();
      expect(logger.error).toHaveBeenCalledWith('Failed to save drawing', { error });
    });

    it('should return null and log warning if creation mutation is not available', async () => {
      (trpc.drawings?.create.useMutation as any).mockReturnValue(null);
      const { result } = renderHook(() => useDrawingPersistence({ sceneId }));

      const saved = await result.current.saveDrawing({ drawingType: DrawingType.FREEHAND });

      expect(saved).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith('Drawing API not available');
    });
  });

  describe('deleteDrawing', () => {
    it('should successfully delete a drawing', async () => {
      const onDrawingDeleted = vi.fn();
      const { result } = renderHook(() => useDrawingPersistence({ sceneId, onDrawingDeleted }));
      mockDeleteMutation.mutateAsync.mockResolvedValue({ id: 'drawing-1' });

      await result.current.deleteDrawing('drawing-1');

      expect(mockDeleteMutation.mutateAsync).toHaveBeenCalledWith({ drawingId: 'drawing-1' });
      expect(logger.info).toHaveBeenCalledWith('Drawing deleted', { drawingId: 'drawing-1' });
      expect(onDrawingDeleted).toHaveBeenCalledWith('drawing-1');
    });

    it('should handle deletion errors', async () => {
      const { result } = renderHook(() => useDrawingPersistence({ sceneId }));
      const error = new Error('Delete failed');
      mockDeleteMutation.mutateAsync.mockRejectedValue(error);

      await result.current.deleteDrawing('d1');

      expect(logger.error).toHaveBeenCalledWith('Failed to delete drawing', { error });
    });

    it('should log warning if deletion mutation is not available', async () => {
      (trpc.drawings?.delete.useMutation as any).mockReturnValue(undefined);
      const { result } = renderHook(() => useDrawingPersistence({ sceneId }));

      await result.current.deleteDrawing('d1');

      expect(logger.warn).toHaveBeenCalledWith('Drawing API not available');
    });

    it('should not call onDrawingDeleted if mutation fails', async () => {
      const onDrawingDeleted = vi.fn();
      const { result } = renderHook(() => useDrawingPersistence({ sceneId, onDrawingDeleted }));
      mockDeleteMutation.mutateAsync.mockRejectedValue(new Error('Fail'));

      await result.current.deleteDrawing('d1');

      expect(onDrawingDeleted).not.toHaveBeenCalled();
    });
  });
});
