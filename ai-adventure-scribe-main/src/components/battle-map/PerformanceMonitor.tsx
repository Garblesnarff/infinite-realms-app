/* eslint-disable max-lines */
/**
 * Performance Monitor Component
 *
 * Displays real-time performance metrics for the battle map:
 * - FPS (Frames Per Second)
 * - Render time
 * - Draw calls
 * - Triangle count
 * - Memory usage
 * - Performance warnings
 *
 * @module components/battle-map/PerformanceMonitor
 */

import { useFrame, useThree } from '@react-three/fiber';
import { AlertTriangle } from 'lucide-react';
import React, { useEffect, useState, useRef } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Z_INDEX } from '@/constants/z-index';
import logger from '@/lib/logger';
import { cn } from '@/lib/utils';

// ===========================
// Types
// ===========================

interface PerformanceMetrics {
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

interface PerformanceMonitorProps {
  /** Whether to show the monitor */
  visible?: boolean;
  /** Position of the monitor */
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** Whether to show detailed metrics */
  detailed?: boolean;
  /** FPS threshold for warning (default: 30) */
  fpsWarningThreshold?: number;
  /** Render time threshold for warning in ms (default: 33) */
  renderTimeWarningThreshold?: number;
  /** Custom className */
  className?: string;
}

// ===========================
// Performance Stats Hook
// ===========================

/**
 * Hook to track performance metrics
 */
function usePerformanceStats() {
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

// ===========================
// Component
// ===========================

/**
 * Performance Monitor Component
 *
 * Displays real-time performance statistics for the 3D battle map.
 *
 * @example
 * ```tsx
 * <PerformanceMonitor
 *   visible={true}
 *   position="top-right"
 *   detailed={true}
 *   fpsWarningThreshold={30}
 * />
 * ```
 */
export const PerformanceMonitor: React.FC<PerformanceMonitorProps> = ({
  visible = true,
  position = 'top-right',
  detailed = false,
  fpsWarningThreshold = 30,
  renderTimeWarningThreshold = 33,
  className,
}) => {
  const metrics = usePerformanceStats();

  if (!visible) {
    return null;
  }

  const showWarning =
    metrics.fps < fpsWarningThreshold || metrics.renderTime > renderTimeWarningThreshold;

  const positionClasses = {
    'top-left': 'top-4 left-4',
    'top-right': 'top-4 right-4',
    'bottom-left': 'bottom-4 left-4',
    'bottom-right': 'bottom-4 right-4',
  };

  const getFPSColor = (fps: number): string => {
    if (fps >= 60) return 'text-green-600';
    if (fps >= 30) return 'text-yellow-600';
    return 'text-red-600';
  };

  return (
    <div
      className={cn('fixed pointer-events-auto', positionClasses[position], className)}
      style={{ zIndex: Z_INDEX.TOAST }}
    >
      <Card className="w-64 shadow-lg">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Performance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs">
          {/* FPS */}
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">FPS:</span>
            <span className={cn('font-mono font-bold', getFPSColor(metrics.fps))}>
              {metrics.fps}
            </span>
          </div>

          {/* Render Time */}
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Frame Time:</span>
            <span className="font-mono">{metrics.renderTime.toFixed(2)}ms</span>
          </div>

          {detailed && (
            <>
              {/* Draw Calls */}
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Draw Calls:</span>
                <span className="font-mono">{metrics.drawCalls.toLocaleString()}</span>
              </div>

              {/* Triangles */}
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Triangles:</span>
                <span className="font-mono">{metrics.triangles.toLocaleString()}</span>
              </div>

              {/* Geometries */}
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Geometries:</span>
                <span className="font-mono">{metrics.geometries}</span>
              </div>

              {/* Textures */}
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Textures:</span>
                <span className="font-mono">{metrics.textures}</span>
              </div>

              {/* Programs */}
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Programs:</span>
                <span className="font-mono">{metrics.programs}</span>
              </div>

              {/* Memory Usage */}
              {metrics.memoryUsed !== undefined && (
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Memory:</span>
                  <span className="font-mono">
                    {metrics.memoryUsed.toFixed(0)} / {metrics.memoryLimit?.toFixed(0) ?? '?'} MB
                  </span>
                </div>
              )}
            </>
          )}

          {/* Warning */}
          {showWarning && (
            <Alert variant="destructive" className="mt-2">
              <AlertTriangle className="h-3 w-3" />
              <AlertDescription className="text-xs ml-2">
                {metrics.fps < fpsWarningThreshold && (
                  <div>Low FPS detected ({metrics.fps} FPS)</div>
                )}
                {metrics.renderTime > renderTimeWarningThreshold && (
                  <div>High render time ({metrics.renderTime.toFixed(1)}ms)</div>
                )}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

/**
 * Simple FPS Counter (minimal UI)
 */
export const FPSCounter: React.FC<{
  className?: string;
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}> = ({ className, position = 'top-right' }) => {
  const metrics = usePerformanceStats();

  const positionClasses = {
    'top-left': 'top-4 left-4',
    'top-right': 'top-4 right-4',
    'bottom-left': 'bottom-4 left-4',
    'bottom-right': 'bottom-4 right-4',
  };

  const getFPSColor = (fps: number): string => {
    if (fps >= 60) return 'text-green-600';
    if (fps >= 30) return 'text-yellow-600';
    return 'text-red-600';
  };

  return (
    <div
      className={cn(
        'fixed pointer-events-none font-mono text-sm font-bold',
        positionClasses[position],
        getFPSColor(metrics.fps),
        className,
      )}
      style={{ zIndex: Z_INDEX.TOAST }}
    >
      {metrics.fps} FPS
    </div>
  );
};

/**
 * Performance Stats for debugging (console output)
 */
export function usePerformanceLogger(enabled: boolean = false, interval: number = 5000) {
  const metrics = usePerformanceStats();
  const lastLogRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled) return;

    const now = Date.now();
    if (now - lastLogRef.current >= interval) {
      lastLogRef.current = now;
      logger.debug('⚡ Performance Metrics', {
        fps: metrics.fps,
        renderTimeMs: metrics.renderTime.toFixed(2),
        drawCalls: metrics.drawCalls,
        triangles: metrics.triangles,
        geometries: metrics.geometries,
        textures: metrics.textures,
        memoryUsedMB: metrics.memoryUsed?.toFixed(0),
        memoryLimitMB: metrics.memoryLimit?.toFixed(0),
      });
    }
  }, [enabled, interval, metrics]);
}

export default PerformanceMonitor;
