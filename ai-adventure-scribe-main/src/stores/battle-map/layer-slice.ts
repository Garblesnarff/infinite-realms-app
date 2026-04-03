/**
 * Layer Slice - Layer visibility, opacity, and locked state management.
 */

import type { BattleMapState, LayerSlice, LayerState } from './types';
import type { StateCreator } from 'zustand';

const defaultLayerState: LayerState = {
  visible: true,
  opacity: 1,
  locked: false,
};

export const createLayerSlice: StateCreator<BattleMapState, [], [], LayerSlice> = (set, get) => ({
  layerVisibility: {},
  layerOpacity: {},
  layerLocked: {},

  toggleLayerVisibility: (layerId) =>
    set(
      (state) => ({
        layerVisibility: {
          ...state.layerVisibility,
          [layerId]: !state.layerVisibility[layerId],
        },
      }),
      false,
      'battleMap/toggleLayerVisibility',
    ),

  setLayerVisibility: (layerId, visible) =>
    set(
      (state) => ({
        layerVisibility: {
          ...state.layerVisibility,
          [layerId]: visible,
        },
      }),
      false,
      'battleMap/setLayerVisibility',
    ),

  setLayerOpacity: (layerId, opacity) =>
    set(
      (state) => ({
        layerOpacity: {
          ...state.layerOpacity,
          [layerId]: Math.max(0, Math.min(1, opacity)),
        },
      }),
      false,
      'battleMap/setLayerOpacity',
    ),

  toggleLayerLock: (layerId) =>
    set(
      (state) => ({
        layerLocked: {
          ...state.layerLocked,
          [layerId]: !state.layerLocked[layerId],
        },
      }),
      false,
      'battleMap/toggleLayerLock',
    ),

  setLayerLock: (layerId, locked) =>
    set(
      (state) => ({
        layerLocked: {
          ...state.layerLocked,
          [layerId]: locked,
        },
      }),
      false,
      'battleMap/setLayerLock',
    ),

  getLayerState: (layerId) => {
    const state = get();
    return {
      visible: state.layerVisibility[layerId] ?? defaultLayerState.visible,
      opacity: state.layerOpacity[layerId] ?? defaultLayerState.opacity,
      locked: state.layerLocked[layerId] ?? defaultLayerState.locked,
    };
  },

  resetLayers: () =>
    set(
      {
        layerVisibility: {},
        layerOpacity: {},
        layerLocked: {},
      },
      false,
      'battleMap/resetLayers',
    ),
});
