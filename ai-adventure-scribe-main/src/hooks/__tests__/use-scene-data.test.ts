/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSceneData } from '../use-scene-data';
import { trpc } from '@/infrastructure/api';

vi.mock('@/infrastructure/api', () => ({
  trpc: {
    scenes: {
      getById: {
        useQuery: vi.fn(),
      },
    },
  },
}));

describe('useSceneData', () => {
  const sceneId = 'scene-123';
  const mockScene = {
    id: sceneId,
    name: 'Battle Scene',
    width: 2000,
    height: 1000,
    gridSize: 50,
    gridType: 'square',
    backgroundImageUrl: 'http://example.com/bg.png',
    settings: { some: 'setting' },
    layers: [{ id: 'layer-1', name: 'Background' }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return scene data when successfully fetched', () => {
    (trpc.scenes.getById.useQuery as any).mockReturnValue({
      data: mockScene,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      isRefetching: false,
    });

    const { result } = renderHook(() => useSceneData({ sceneId }));

    expect(result.current.scene).toEqual(mockScene);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.settings).toEqual(mockScene.settings);
    expect(result.current.layers).toEqual(mockScene.layers);
    expect(result.current.width).toBe(mockScene.width);
    expect(result.current.gridSize).toBe(mockScene.gridSize);
    expect(result.current.backgroundImageUrl).toBe(mockScene.backgroundImageUrl);
  });

  it('should reflect loading state', () => {
    (trpc.scenes.getById.useQuery as any).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
      isRefetching: false,
    });

    const { result } = renderHook(() => useSceneData({ sceneId }));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.scene).toBeUndefined();
  });

  it('should reflect error state', () => {
    const mockError = { message: 'Failed to fetch scene' };
    (trpc.scenes.getById.useQuery as any).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: mockError,
      refetch: vi.fn(),
      isRefetching: false,
    });

    const { result } = renderHook(() => useSceneData({ sceneId }));

    expect(result.current.error).toEqual(mockError);
  });

  it('should disable query when sceneId is missing', () => {
    (trpc.scenes.getById.useQuery as any).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      isRefetching: false,
    });

    renderHook(() => useSceneData({ sceneId: '' }));

    expect(trpc.scenes.getById.useQuery).toHaveBeenCalledWith(
      { sceneId: '' },
      expect.objectContaining({ enabled: false }),
    );
  });

  it('should respect the enabled prop', () => {
    (trpc.scenes.getById.useQuery as any).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      isRefetching: false,
    });

    renderHook(() => useSceneData({ sceneId, enabled: false }));

    expect(trpc.scenes.getById.useQuery).toHaveBeenCalledWith(
      { sceneId },
      expect.objectContaining({ enabled: false }),
    );
  });
});
