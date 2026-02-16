/**
 * Re-export shim for backward compatibility.
 *
 * The battle map store has been decomposed into Zustand slices
 * located in @/stores/battle-map/. This file re-exports everything
 * so existing imports continue to work unchanged.
 */

export {
  // Store hook
  useBattleMapStore,
  // Types
  type LayerType,
  type ToolType,
  type PerformanceMode,
  type CameraState,
  type PerformanceSettings,
  type LayerState,
  type BattleMapState,
  // Selector hooks
  useActiveSceneId,
  useLayerState,
  useCamera,
  useSelectedTool,
  useLayerVisibility,
  useLayerOpacity,
  useLayerLocked,
  useSelectedTokenIds,
  useTargetedTokenIds,
  useDraggedTokenId,
  useIsTokenSelected,
  useIsTokenTargeted,
  useHoveredTokenId,
  useIsTokenHovered,
  useFogSettings,
  useWallSettings,
  usePerformanceSettings,
  usePerformanceMode,
  useParticlesEnabled,
  useShadowsEnabled,
  useAnimationsEnabled,
} from './battle-map';
