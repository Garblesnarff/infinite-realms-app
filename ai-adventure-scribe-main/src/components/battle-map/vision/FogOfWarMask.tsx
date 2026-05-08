import React, { useMemo } from 'react';

import type { VisionPolygon as VisionPolygonType } from '@/utils/vision-polygon';

export interface VisionMaskProps {
  /** Vision polygons to render as fog mask */
  polygons: VisionPolygonType[];
  /** Canvas dimensions */
  canvasWidth: number;
  canvasHeight: number;
  /** Fog color */
  fogColor?: string;
  /** Fog opacity */
  fogOpacity?: number;
}

/**
 * Render fog of war as inverted mask of vision polygons
 *
 * Uses SVG masking to show fog everywhere except visible areas.
 *
 * @example
 * ```tsx
 * <FogOfWarMask
 *   polygons={visionPolygons}
 *   canvasWidth={2000}
 *   canvasHeight={2000}
 *   fogColor="#000000"
 *   fogOpacity={0.8}
 * />
 * ```
 *
 * ⚡ Bolt: Wrapped in React.memo to prevent redundant re-renders.
 */
export const FogOfWarMask: React.FC<VisionMaskProps> = React.memo(
  ({ polygons, canvasWidth, canvasHeight, fogColor = '#000000', fogOpacity = 0.85 }) => {
    const maskId = useMemo(() => `fog-mask-${Math.random().toString(36).substr(2, 9)}`, []);

    // Create paths for all vision polygons
    const visionPaths = useMemo(() => {
      return polygons
        .filter((p) => p.points.length > 0)
        .map((polygon, index) => {
          let path = `M ${polygon.points[0].x} ${polygon.points[0].y}`;
          for (let i = 1; i < polygon.points.length; i++) {
            path += ` L ${polygon.points[i].x} ${polygon.points[i].y}`;
          }
          path += ' Z';
          return { path, key: `vision-${index}` };
        });
    }, [polygons]);

    return (
      <g className="fog-of-war">
        <defs>
          <mask id={maskId}>
            {/* White background = show fog */}
            <rect x={0} y={0} width={canvasWidth} height={canvasHeight} fill="white" />

            {/* Black areas = hide fog (visible areas) */}
            {visionPaths.map(({ path, key }) => (
              <path key={key} d={path} fill="black" />
            ))}
          </mask>
        </defs>

        {/* Fog layer with mask applied */}
        <rect
          x={0}
          y={0}
          width={canvasWidth}
          height={canvasHeight}
          fill={fogColor}
          fillOpacity={fogOpacity}
          mask={`url(#${maskId})`}
          pointerEvents="none"
        />
      </g>
    );
  },
);

export default FogOfWarMask;
