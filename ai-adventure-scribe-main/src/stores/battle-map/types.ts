/**
 * Shared types for Battle Map store slices.
 */

// ===========================
// Types
// ===========================

export type LayerType =
  | 'background'
  | 'grid'
  | 'tokens'
  | 'effects'
  | 'drawings'
  | 'ui'
  | 'fog'
  | 'walls';

export type ToolType = 'select' | 'move' | 'measure' | 'draw' | 'pan' | 'wall' | 'fog-brush';

export type PerformanceMode = 'low' | 'medium' | 'high';

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

export interface PerformanceSettings {
  performanceMode: PerformanceMode;
  enableParticles: boolean;
  enableShadows: boolean;
  enableAnimations: boolean;
  maxVisibleTokens: number;
  maxParticles: number;
  enableFrustumCulling: boolean;
  enableLOD: boolean;
}

export interface LayerState {
  visible: boolean;
  opacity: number;
  locked: boolean;
}

// ===========================
// Slice Interfaces
// ===========================

export interface SceneSlice {
  activeSceneId: string | null;
  selectedTool: ToolType;
  setActiveSceneId: (sceneId: string | null) => void;
  setTool: (tool: ToolType) => void;
}

export interface LayerSlice {
  layerVisibility: Record<string, boolean>;
  layerOpacity: Record<string, number>;
  layerLocked: Record<string, boolean>;
  toggleLayerVisibility: (layerId: string) => void;
  setLayerVisibility: (layerId: string, visible: boolean) => void;
  setLayerOpacity: (layerId: string, opacity: number) => void;
  toggleLayerLock: (layerId: string) => void;
  setLayerLock: (layerId: string, locked: boolean) => void;
  getLayerState: (layerId: string) => LayerState;
  resetLayers: () => void;
}

export interface CameraSlice {
  camera: CameraState;
  setCamera: (camera: Partial<CameraState>) => void;
  resetCamera: () => void;
}

export interface TokenSelectionSlice {
  selectedTokenIds: string[];
  targetedTokenIds: string[];
  hoveredTokenId: string | null;
  draggedTokenId: string | null;
  optimisticTokenUpdates: Map<string, { x: number; y: number; optimisticId: string }>;
  selectToken: (tokenId: string, multiSelect?: boolean) => void;
  deselectToken: (tokenId: string) => void;
  toggleSelectToken: (tokenId: string) => void;
  clearSelection: () => void;
  targetToken: (tokenId: string, replace?: boolean) => void;
  clearTargets: () => void;
  setHoveredToken: (tokenId: string | null) => void;
  setDraggedToken: (tokenId: string | null) => void;
  addOptimisticUpdate: (tokenId: string, x: number, y: number, optimisticId: string) => void;
  removeOptimisticUpdate: (optimisticId: string) => void;
  clearOptimisticUpdates: () => void;
}

export interface FogSlice {
  fogEnabled: boolean;
  showFogToGM: boolean;
  fogBrushSize: number;
  fogBrushMode: 'reveal' | 'conceal';
  toggleFog: () => void;
  setFogEnabled: (enabled: boolean) => void;
  toggleShowFogToGM: () => void;
  setShowFogToGM: (show: boolean) => void;
  setFogBrushSize: (size: number) => void;
  setFogBrushMode: (mode: 'reveal' | 'conceal') => void;
}

export interface WallSlice {
  selectedWallId: string | null;
  hoveredWallId: string | null;
  wallDrawingActive: boolean;
  wallSnapToGrid: boolean;
  wallType: 'solid' | 'door' | 'window' | 'terrain';
  selectWall: (wallId: string | null) => void;
  setHoveredWall: (wallId: string | null) => void;
  toggleWallDrawing: () => void;
  setWallDrawingActive: (active: boolean) => void;
  toggleWallSnapToGrid: () => void;
  setWallSnapToGrid: (snap: boolean) => void;
  setWallType: (type: 'solid' | 'door' | 'window' | 'terrain') => void;
}

export interface PerformanceSlice {
  performance: PerformanceSettings;
  setPerformanceMode: (mode: PerformanceMode) => void;
  setPerformanceSetting: <K extends keyof PerformanceSettings>(
    key: K,
    value: PerformanceSettings[K],
  ) => void;
  resetPerformanceSettings: () => void;
}

// ===========================
// Combined State
// ===========================

export type BattleMapState = SceneSlice &
  LayerSlice &
  CameraSlice &
  TokenSelectionSlice &
  FogSlice &
  WallSlice &
  PerformanceSlice;
