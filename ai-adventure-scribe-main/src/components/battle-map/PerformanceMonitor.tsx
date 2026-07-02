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

import { AlertTriangle } from 'lucide-react';
import React from 'react';

import { usePerformanceStats } from './use-performance-stats';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Z_INDEX } from '@/constants/z-index';
import { cn } from '@/lib/utils';

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

export default PerformanceMonitor;
