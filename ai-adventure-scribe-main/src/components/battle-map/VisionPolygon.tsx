/**
 * Vision Polygon Component
 *
 * Renders the visible area polygon for tokens and handles fog-of-war clipping.
 * Integrates with the vision worker for efficient calculation.
 *
 * @module components/battle-map/VisionPolygon
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';

import { FogOfWarMask } from './vision/FogOfWarMask';
import { useVisionPolygon } from './vision/use-vision-polygon';
import { VisionBoundary } from './vision/VisionBoundary';

import type { VisionBlocker } from '@/types/scene';
import type { Token } from '@/types/token';
import type { VisionPolygon as VisionPolygonType } from '@/utils/vision-polygon';

import logger from '@/lib/logger';
import { getVisionColor, getVisionOpacity } from '@/utils/vision/vision-color-utils';
import { calculateVisionPolygon, mergeVisionPolygons } from '@/utils/vision-polygon';


// Re-export for backward compatibility
export { FogOfWarMask, VisionBoundary, useVisionPolygon };
export type { VisionMaskProps } from './vision/FogOfWarMask';
export type { VisionBoundaryProps } from './vision/VisionBoundary';

// ===========================
// Types
// ===========================

interface VisionPolygonProps {
  /** Token(s) to render vision for */
  tokens: Token | Token[];
  /** Vision blocking walls */
  walls: VisionBlocker[];
  /** Override vision range in pixels */
  range?: number;
  /** Whether to show vision boundary (debug) */
  showBoundary?: boolean;
  /** Whether to use Web Worker for calculation */
  useWorker?: boolean;
  /** Custom color override */
  color?: string;
  /** Custom opacity override */
  opacity?: number;
  /** Whether this is GM view (sees all) */
  isGMView?: boolean;
}

// ===========================
// Vision Polygon Component
// ===========================

/**
 * Render vision polygon for one or more tokens
 *
 * @example
 * ```tsx
 * <VisionPolygon
 *   tokens={playerTokens}
 *   walls={sceneWalls}
 *   range={600}
 *   showBoundary={false}
 * />
 * ```
 *
 * ⚡ Bolt: Wrapped in React.memo to prevent redundant re-renders.
 */
export const VisionPolygon: React.FC<VisionPolygonProps> = React.memo(
  ({
    tokens,
    walls,
    range,
    showBoundary = false,
    useWorker = false,
    color,
    opacity,
    isGMView = false,
  }) => {
    const [polygon, setPolygon] = useState<VisionPolygonType | null>(null);
    const workerRef = useRef<Worker | null>(null);
    const requestIdRef = useRef(0);

    // ⚡ Bolt: Normalize and memoize tokens to array to stabilize reference for useEffect.
    const tokenArray = useMemo(() => (Array.isArray(tokens) ? tokens : [tokens]), [tokens]);

    // Calculate vision polygon
    useEffect(() => {
      if (isGMView) {
        // GM sees everything, no vision restrictions
        setPolygon(null);
        return;
      }

      if (useWorker && typeof Worker !== 'undefined') {
        // Use Web Worker for heavy calculations
        if (!workerRef.current) {
          // Create worker (path needs to be adjusted based on build config)
          try {
            workerRef.current = new Worker(
              new URL('../../workers/vision-worker.ts', import.meta.url),
            );

            workerRef.current.onmessage = (event) => {
              const response = event.data;

              if (response.type === 'MULTI_VISION_RESULT') {
                const polygons = Object.values(response.payload.polygons);
                if (polygons.length > 0) {
                  const merged = mergeVisionPolygons(polygons as VisionPolygonType[]);
                  setPolygon(merged);
                }
              } else if (response.type === 'ERROR') {
                logger.error('Vision worker error:', response.payload.error);
                // Fallback to synchronous calculation
                calculateSync();
              }
            };
          } catch (error) {
            logger.warn('Failed to create vision worker, using sync calculation:', error);
            calculateSync();
            return;
          }
        }

        // Send calculation request
        const requestId = `req-${++requestIdRef.current}`;
        workerRef.current.postMessage({
          type: 'CALCULATE_MULTI_VISION',
          payload: {
            tokens: tokenArray,
            walls,
            range,
          },
          requestId,
        });
      } else {
        // Synchronous calculation
        calculateSync();
      }

      function calculateSync(): void {
        if (tokenArray.length === 1) {
          const poly = calculateVisionPolygon(tokenArray[0], walls, range);
          setPolygon(poly);
        } else {
          const polygons = tokenArray.map((token) => calculateVisionPolygon(token, walls, range));
          const merged = mergeVisionPolygons(polygons);
          setPolygon(merged);
        }
      }

      // Cleanup worker on unmount
      return () => {
        if (workerRef.current) {
          workerRef.current.terminate();
          workerRef.current = null;
        }
      };
    }, [isGMView, useWorker, tokenArray, walls, range]);

    // Determine visual properties
    const visionColor = useMemo(() => {
      if (color) return color;
      if (!polygon) return '#ffffff';
      return getVisionColor(polygon.visionMode);
    }, [color, polygon]);

    const visionOpacity = useMemo(() => {
      if (opacity !== undefined) return opacity;
      if (!polygon) return 0.15;
      return getVisionOpacity(polygon.visionMode);
    }, [opacity, polygon]);

    // Create SVG path from polygon points
    const pathData = useMemo(() => {
      if (!polygon || !polygon.points.length) return '';

      const points = polygon.points;
      let path = `M ${points[0].x} ${points[0].y}`;

      for (let i = 1; i < points.length; i++) {
        path += ` L ${points[i].x} ${points[i].y}`;
      }

      path += ' Z'; // Close path
      return path;
    }, [polygon]);

    // Don't render if no polygon or GM view
    if (!polygon || polygon.points.length === 0 || isGMView) {
      return null;
    }

    return (
      <g className="vision-polygon">
        {/* Visible area fill */}
        <path
          d={pathData}
          fill={visionColor}
          fillOpacity={visionOpacity}
          stroke="none"
          pointerEvents="none"
        />

        {/* Optional boundary (debug/GM view) */}
        {showBoundary && (
          <path
            d={pathData}
            fill="none"
            stroke={visionColor}
            strokeWidth={2}
            strokeOpacity={0.5}
            strokeDasharray="5,5"
            pointerEvents="none"
          />
        )}
      </g>
    );
  },
);

// ===========================
// Default Export
// ===========================

export default VisionPolygon;
