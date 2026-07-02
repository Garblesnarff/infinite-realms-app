/**
 * Performance stats tracking hook, split out of PerformanceMonitor.tsx.
 */

import { useFrame, useThree } from '@react-three/fiber';
import { useState, useRef } from 'react';

export interface PerformanceMetrics {
  fps: number;
  renderTime: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
  memoryUsed?: number;
  memoryLimit?: number;
}

interface PerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

/**
 * Hook to track performance metrics
 */
export function usePerformanceStats(): PerformanceMetrics {
  const { gl } = useThree();
  const [metrics, setMetrics] = useState<PerformanceMetrics>({
    fps: 60,
    renderTime: 0,
    drawCalls: 0,
    triangles: 0,
    geometries: 0,
    textures: 0,
    programs: 0,
  });

  const frameTimesRef = useRef<number[]>([]);
  const lastTimeRef = useRef<number>(performance.now());
  const updateIntervalRef = useRef<number>(0);

  useFrame(() => {
    const now = performance.now();
    const delta = now - lastTimeRef.current;
    lastTimeRef.current = now;

    // Collect frame times
    frameTimesRef.current.push(delta);
    if (frameTimesRef.current.length > 60) {
      frameTimesRef.current.shift();
    }

    // Update metrics every 500ms to avoid too frequent updates
    updateIntervalRef.current += delta;
    if (updateIntervalRef.current >= 500) {
      updateIntervalRef.current = 0;

      // Calculate average FPS
      const avgFrameTime =
        frameTimesRef.current.reduce((a, b) => a + b, 0) / frameTimesRef.current.length;
      const fps = Math.round(1000 / avgFrameTime);

      // Get renderer info
      const info = gl.info;
      const memory = gl.info.memory;

      // Get memory info if available (non-standard Chrome-only API, not in lib.dom.d.ts)
      let memoryUsed: number | undefined;
      let memoryLimit: number | undefined;

      const perfMemory = (performance as Performance & { memory?: PerformanceMemory }).memory;
      if (perfMemory) {
        memoryUsed = perfMemory.usedJSHeapSize / 1024 / 1024; // Convert to MB
        memoryLimit = perfMemory.jsHeapSizeLimit / 1024 / 1024; // Convert to MB
      }

      setMetrics({
        fps,
        renderTime: avgFrameTime,
        drawCalls: info.render.calls,
        triangles: info.render.triangles,
        geometries: memory?.geometries ?? 0,
        textures: memory?.textures ?? 0,
        programs: info.programs?.length ?? 0,
        memoryUsed,
        memoryLimit,
      });
    }
  });

  return metrics;
}
