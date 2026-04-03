/**
 * Fog Slice - Fog of war settings and controls.
 */

import type { BattleMapState, FogSlice } from './types';
import type { StateCreator } from 'zustand';

export const createFogSlice: StateCreator<BattleMapState, [], [], FogSlice> = (set) => ({
  fogEnabled: true,
  showFogToGM: false,
  fogBrushSize: 50,
  fogBrushMode: 'reveal' as 'reveal' | 'conceal',

  toggleFog: () =>
    set((state) => ({ fogEnabled: !state.fogEnabled }), false, 'battleMap/toggleFog'),

  setFogEnabled: (enabled) => set({ fogEnabled: enabled }, false, 'battleMap/setFogEnabled'),

  toggleShowFogToGM: () =>
    set((state) => ({ showFogToGM: !state.showFogToGM }), false, 'battleMap/toggleShowFogToGM'),

  setShowFogToGM: (show) => set({ showFogToGM: show }, false, 'battleMap/setShowFogToGM'),

  setFogBrushSize: (size) => set({ fogBrushSize: size }, false, 'battleMap/setFogBrushSize'),

  setFogBrushMode: (mode) => set({ fogBrushMode: mode }, false, 'battleMap/setFogBrushMode'),
});
