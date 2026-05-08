import { lineSegmentsIntersect } from '../geometry';

import type { Point2D, VisionBlocker } from '@/types/scene';
import type { Token } from '@/types/token';

/**
 * Shadow segment cast by wall
 */
export interface ShadowSegment {
  points: Point2D[];
  opacity: number;
}

/**
 * Calculate shadows cast by walls from a light source
 *
 * Creates shadow polygons extending from walls away from light.
 *
 * @param lightSource - Light emitting token
 * @param walls - Walls that cast shadows
 * @param maxShadowLength - How far shadows extend
 * @returns Array of shadow segments
 *
 * @example
 * ```ts
 * const shadows = calculateShadows(torch, walls, 1000);
 * // Render shadows with opacity
 * ```
 */
export function calculateShadows(
  lightSource: Token,
  walls: VisionBlocker[],
  maxShadowLength: number = 2000,
): ShadowSegment[] {
  if (!lightSource.light.emitsLight) {
    return [];
  }

  const origin: Point2D = { x: lightSource.x, y: lightSource.y };
  const shadows: ShadowSegment[] = [];

  for (const wall of walls) {
    if (!wall.blocksLight) continue;

    // Process each wall segment
    for (let i = 0; i < wall.points.length - 1; i++) {
      const p1 = wall.points[i];
      const p2 = wall.points[i + 1];

      // Calculate shadow polygon
      const shadow = castShadowFromSegment(origin, p1, p2, maxShadowLength);
      if (shadow) {
        shadows.push({
          points: shadow,
          opacity: 0.7,
        });
      }
    }

    // Handle closing segment for polygons
    if (wall.points.length > 2) {
      const p1 = wall.points[wall.points.length - 1];
      const p2 = wall.points[0];
      const shadow = castShadowFromSegment(origin, p1, p2, maxShadowLength);
      if (shadow) {
        shadows.push({
          points: shadow,
          opacity: 0.7,
        });
      }
    }
  }

  return shadows;
}

/**
 * Cast shadow from a wall segment
 */
function castShadowFromSegment(
  lightPos: Point2D,
  segmentStart: Point2D,
  segmentEnd: Point2D,
  shadowLength: number,
): Point2D[] | null {
  // Calculate if wall faces light
  const toStart = { x: segmentStart.x - lightPos.x, y: segmentStart.y - lightPos.y };
  const toEnd = { x: segmentEnd.x - lightPos.x, y: segmentEnd.y - lightPos.y };

  // Wall normal (perpendicular)
  const wallDx = segmentEnd.x - segmentStart.x;
  const wallDy = segmentEnd.y - segmentStart.y;
  const normalX = -wallDy;
  const normalY = wallDx;

  // Check if wall faces away from light (casts shadow)
  const dotProduct = toStart.x * normalX + toStart.y * normalY;
  if (dotProduct > 0) {
    return null; // Wall faces light, no shadow on this side
  }

  // Project segment endpoints away from light
  const startLength = Math.sqrt(toStart.x * toStart.x + toStart.y * toStart.y);
  const endLength = Math.sqrt(toEnd.x * toEnd.x + toEnd.y * toEnd.y);

  const projectedStart = {
    x: segmentStart.x + (toStart.x / startLength) * shadowLength,
    y: segmentStart.y + (toStart.y / startLength) * shadowLength,
  };

  const projectedEnd = {
    x: segmentEnd.x + (toEnd.x / endLength) * shadowLength,
    y: segmentEnd.y + (toEnd.y / endLength) * shadowLength,
  };

  // Create shadow quad
  return [segmentStart, projectedStart, projectedEnd, segmentEnd];
}

/**
 * Calculate ambient occlusion approximation
 *
 * Samples light accessibility at grid points to create soft shadowing.
 * This is a simplified approximation, not true ambient occlusion.
 *
 * @param bounds - Area to calculate AO for
 * @param walls - Walls that block light
 * @param gridSize - Size of sampling grid
 * @param sampleRadius - Radius to sample around each point
 * @returns Grid of occlusion values (0 = fully occluded, 1 = fully lit)
 */
export function calculateAmbientOcclusion(
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  walls: VisionBlocker[],
  gridSize: number = 50,
  sampleRadius: number = 100,
): number[][] {
  const width = Math.ceil((bounds.maxX - bounds.minX) / gridSize);
  const height = Math.ceil((bounds.maxY - bounds.minY) / gridSize);

  const grid: number[][] = [];

  for (let y = 0; y < height; y++) {
    const row: number[] = [];

    for (let x = 0; x < width; x++) {
      const worldX = bounds.minX + x * gridSize;
      const worldY = bounds.minY + y * gridSize;

      // Sample multiple directions
      const numSamples = 16;
      let visibleSamples = 0;

      for (let i = 0; i < numSamples; i++) {
        const angle = (i / numSamples) * Math.PI * 2;
        const sampleX = worldX + Math.cos(angle) * sampleRadius;
        const sampleY = worldY + Math.sin(angle) * sampleRadius;

        // Check if ray to sample point is blocked
        let isBlocked = false;
        for (const wall of walls) {
          if (!wall.blocksLight) continue;

          for (let j = 0; j < wall.points.length - 1; j++) {
            if (
              lineSegmentsIntersect(
                { x: worldX, y: worldY },
                { x: sampleX, y: sampleY },
                wall.points[j],
                wall.points[j + 1],
              )
            ) {
              isBlocked = true;
              break;
            }
          }

          if (isBlocked) break;
        }

        if (!isBlocked) {
          visibleSamples++;
        }
      }

      // Occlusion value: 0 = fully occluded, 1 = fully lit
      row.push(visibleSamples / numSamples);
    }

    grid.push(row);
  }

  return grid;
}
