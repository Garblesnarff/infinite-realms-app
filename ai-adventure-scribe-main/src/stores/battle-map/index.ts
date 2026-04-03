/**
 * Battle Map Store - Composed from Zustand slices.
 *
 * Manages battle map state including layers, camera, tool selection,
 * token selection, fog of war, walls, and performance settings.
 * Uses localStorage persistence for user preferences.
 */

import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

import { createCameraSlice, createSceneSlice } from './camera-slice';
import { createFogSlice } from './fog-slice';
import { createLayerSlice } from './layer-slice';
import { createPerformanceSlice } from './performance-slice';
import { createTokenSelectionSlice } from './token-selection-slice';
import { createWallSlice } from './wall-slice';

import type { BattleMapState } from './types';

// Re-export all types
export type {
  LayerType,
  ToolType,
  PerformanceMode,
  CameraState,
  PerformanceSettings,
  LayerState,
  BattleMapState,
} from './types';

// ===========================
// Store Creation
// ===========================

export const useBattleMapStore = create<BattleMapState>()(
  devtools(
    persist(
      (...a) => ({
        ...createSceneSlice(...a),
        ...createLayerSlice(...a),
        ...createCameraSlice(...a),
        ...createTokenSelectionSlice(...a),
        ...createFogSlice(...a),
        ...createWallSlice(...a),
        ...createPerformanceSlice(...a),
      }),
      {
        name: 'battle-map-storage',
        // Only persist user preferences, not the active scene
        partialize: (state) => ({
          layerVisibility: state.layerVisibility,
          layerOpacity: state.layerOpacity,
          layerLocked: state.layerLocked,
          camera: state.camera,
          selectedTool: state.selectedTool,
          fogEnabled: state.fogEnabled,
          showFogToGM: state.showFogToGM,
          fogBrushSize: state.fogBrushSize,
          wallSnapToGrid: state.wallSnapToGrid,
          performance: state.performance,
        }),
      },
    ),
    { name: 'BattleMapStore' },
  ),
);

// ===========================
// Selector Hooks
// ===========================

/**
 * Hook to get the active scene ID
 */
export const useActiveSceneId = () => useBattleMapStore((state) => state.activeSceneId);

/**
 * Hook to get layer state for a specific layer
 */
export const useLayerState = (layerId: string) =>
  useBattleMapStore((state) => state.getLayerState(layerId));

/**
 * Hook to get camera state
 */
export const useCamera = () => useBattleMapStore((state) => state.camera);

/**
 * Hook to get selected tool
 */
export const useSelectedTool = () => useBattleMapStore((state) => state.selectedTool);

/**
 * Hook to get layer visibility for a specific layer
 */
export const useLayerVisibility = (layerId: string) =>
  useBattleMapStore((state) => state.layerVisibility[layerId] ?? true);

/**
 * Hook to get layer opacity for a specific layer
 */
export const useLayerOpacity = (layerId: string) =>
  useBattleMapStore((state) => state.layerOpacity[layerId] ?? 1);

/**
 * Hook to get layer lock state for a specific layer
 */
export const useLayerLocked = (layerId: string) =>
  useBattleMapStore((state) => state.layerLocked[layerId] ?? false);

/**
 * Hook to get selected token IDs
 */
export const useSelectedTokenIds = () => useBattleMapStore((state) => state.selectedTokenIds);

/**
 * Hook to get targeted token IDs
 */
export const useTargetedTokenIds = () => useBattleMapStore((state) => state.targetedTokenIds);

/**
 * Hook to get dragged token ID
 */
export const useDraggedTokenId = () => useBattleMapStore((state) => state.draggedTokenId);

/**
 * Hook to check if a specific token is selected
 */
export const useIsTokenSelected = (tokenId: string) =>
  useBattleMapStore((state) => state.selectedTokenIds.includes(tokenId));

/**
 * Hook to check if a specific token is targeted
 */
export const useIsTokenTargeted = (tokenId: string) =>
  useBattleMapStore((state) => state.targetedTokenIds.includes(tokenId));

/**
 * Hook to get hovered token ID
 */
export const useHoveredTokenId = () => useBattleMapStore((state) => state.hoveredTokenId);

/**
 * Hook to check if a specific token is hovered
 */
export const useIsTokenHovered = (tokenId: string) =>
  useBattleMapStore((state) => state.hoveredTokenId === tokenId);

/**
 * Hook to get fog of war settings
 */
export const useFogSettings = () =>
  useBattleMapStore((state) => ({
    fogEnabled: state.fogEnabled,
    showFogToGM: state.showFogToGM,
    fogBrushSize: state.fogBrushSize,
    fogBrushMode: state.fogBrushMode,
  }));

/**
 * Hook to get wall settings
 */
export const useWallSettings = () =>
  useBattleMapStore((state) => ({
    selectedWallId: state.selectedWallId,
    hoveredWallId: state.hoveredWallId,
    wallDrawingActive: state.wallDrawingActive,
    wallSnapToGrid: state.wallSnapToGrid,
    wallType: state.wallType,
  }));

/**
 * Hook to get performance settings
 */
export const usePerformanceSettings = () => useBattleMapStore((state) => state.performance);

/**
 * Hook to get performance mode
 */
export const usePerformanceMode = () =>
  useBattleMapStore((state) => state.performance.performanceMode);

/**
 * Hook to check if particles are enabled
 */
export const useParticlesEnabled = () =>
  useBattleMapStore((state) => state.performance.enableParticles);

/**
 * Hook to check if shadows are enabled
 */
export const useShadowsEnabled = () =>
  useBattleMapStore((state) => state.performance.enableShadows);

/**
 * Hook to check if animations are enabled
 */
export const useAnimationsEnabled = () =>
  useBattleMapStore((state) => state.performance.enableAnimations);
