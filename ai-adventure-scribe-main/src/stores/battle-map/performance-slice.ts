/**
 * Performance Slice - Performance presets and settings.
 */

import type {
  BattleMapState,
  PerformanceMode,
  PerformanceSettings,
  PerformanceSlice,
} from './types';
import type { StateCreator } from 'zustand';

const defaultPerformanceSettings: PerformanceSettings = {
  performanceMode: 'high',
  enableParticles: true,
  enableShadows: true,
  enableAnimations: true,
  maxVisibleTokens: 200,
  maxParticles: 100,
  enableFrustumCulling: true,
  enableLOD: true,
};

export { defaultPerformanceSettings };

export const createPerformanceSlice: StateCreator<BattleMapState, [], [], PerformanceSlice> = (
  set,
) => ({
  performance: defaultPerformanceSettings,

  setPerformanceMode: (mode) => {
    const presets: Record<PerformanceMode, PerformanceSettings> = {
      low: {
        performanceMode: 'low',
        enableParticles: false,
        enableShadows: false,
        enableAnimations: false,
        maxVisibleTokens: 50,
        maxParticles: 0,
        enableFrustumCulling: true,
        enableLOD: true,
      },
      medium: {
        performanceMode: 'medium',
        enableParticles: true,
        enableShadows: false,
        enableAnimations: true,
        maxVisibleTokens: 100,
        maxParticles: 50,
        enableFrustumCulling: true,
        enableLOD: true,
      },
      high: {
        performanceMode: 'high',
        enableParticles: true,
        enableShadows: true,
        enableAnimations: true,
        maxVisibleTokens: 200,
        maxParticles: 100,
        enableFrustumCulling: true,
        enableLOD: true,
      },
    };

    set({ performance: presets[mode] }, false, 'battleMap/setPerformanceMode');
  },

  setPerformanceSetting: (key, value) =>
    set(
      (state) => ({
        performance: {
          ...state.performance,
          [key]: value,
        },
      }),
      false,
      'battleMap/setPerformanceSetting',
    ),

  resetPerformanceSettings: () =>
    set({ performance: defaultPerformanceSettings }, false, 'battleMap/resetPerformanceSettings'),
});
