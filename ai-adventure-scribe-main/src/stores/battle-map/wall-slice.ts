/**
 * Wall Slice - Wall drawing settings and controls.
 */

import type { BattleMapState, WallSlice } from './types';
import type { StateCreator } from 'zustand';

export const createWallSlice: StateCreator<BattleMapState, [], [], WallSlice> = (set) => ({
  selectedWallId: null,
  hoveredWallId: null,
  wallDrawingActive: false,
  wallSnapToGrid: true,
  wallType: 'solid' as 'solid' | 'door' | 'window' | 'terrain',

  selectWall: (wallId) => set({ selectedWallId: wallId }, false, 'battleMap/selectWall'),

  setHoveredWall: (wallId) => set({ hoveredWallId: wallId }, false, 'battleMap/setHoveredWall'),

  toggleWallDrawing: () =>
    set(
      (state) => ({ wallDrawingActive: !state.wallDrawingActive }),
      false,
      'battleMap/toggleWallDrawing',
    ),

  setWallDrawingActive: (active) =>
    set({ wallDrawingActive: active }, false, 'battleMap/setWallDrawingActive'),

  toggleWallSnapToGrid: () =>
    set(
      (state) => ({ wallSnapToGrid: !state.wallSnapToGrid }),
      false,
      'battleMap/toggleWallSnapToGrid',
    ),

  setWallSnapToGrid: (snap) => set({ wallSnapToGrid: snap }, false, 'battleMap/setWallSnapToGrid'),

  setWallType: (type) => set({ wallType: type }, false, 'battleMap/setWallType'),
});
