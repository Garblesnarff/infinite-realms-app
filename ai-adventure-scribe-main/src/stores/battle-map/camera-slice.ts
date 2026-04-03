/**
 * Camera Slice - Camera position, zoom, scene, and tool management.
 */

import type { BattleMapState, CameraSlice, CameraState, SceneSlice, ToolType } from './types';
import type { StateCreator } from 'zustand';

const initialCamera: CameraState = {
  x: 0,
  y: 0,
  zoom: 1,
};

export const createCameraSlice: StateCreator<BattleMapState, [], [], CameraSlice> = (set) => ({
  camera: initialCamera,

  setCamera: (camera) =>
    set(
      (state) => ({
        camera: {
          ...state.camera,
          ...camera,
        },
      }),
      false,
      'battleMap/setCamera',
    ),

  resetCamera: () => set({ camera: initialCamera }, false, 'battleMap/resetCamera'),
});

export const createSceneSlice: StateCreator<BattleMapState, [], [], SceneSlice> = (set) => ({
  activeSceneId: null,
  selectedTool: 'select' as ToolType,

  setActiveSceneId: (sceneId) =>
    set({ activeSceneId: sceneId }, false, 'battleMap/setActiveSceneId'),

  setTool: (tool) => set({ selectedTool: tool }, false, 'battleMap/setTool'),
});
