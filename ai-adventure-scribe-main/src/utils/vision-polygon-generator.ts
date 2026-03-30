/**
 * Vision Polygon Generation Utilities
 *
 * Extracted from raycasting.ts to focus on vision-specific geometry.
 * Handles the collection of ray intersections and vertex sorting for
 * polygon construction.
 *
 * @module utils/vision-polygon-generator
 */

import { raycastToWalls } from './raycasting';

import type { Point2D, VisionBlocker } from '@/types/scene';

/**
 * Vision endpoint for polygon calculation
 */
export interface VisionEndpoint {
  point: Point2D;
  angle: number;
  distance: number;
  isWallVertex: boolean;
  wallId?: string;
}

/**
 * Get all ray intersections from origin to all wall endpoints and corners
 *
 * This is the core of vision polygon calculation. Casts rays to all wall vertices
 * and slightly offset angles to handle edge cases properly.
 *
 * @param origin - Center point (token position)
 * @param walls - All walls in the scene
 * @param maxRange - Maximum vision range in pixels
 * @returns Array of vision endpoints sorted by angle
 *
 * @example
 * ```ts
 * const endpoints = getAllRayIntersections(tokenPos, walls, 600);
 * // endpoints are sorted clockwise from -PI to PI
 * ```
 */
export function getAllRayIntersections(
  origin: Point2D,
  walls: VisionBlocker[],
  maxRange: number = 1000,
): VisionEndpoint[] {
  const endpoints: VisionEndpoint[] = [];
  const uniqueAngles = new Set<number>();

  // Collect all wall vertices
  const wallVertices: Array<{ point: Point2D; wallId: string }> = [];
  for (const wall of walls) {
    if (!wall.blocksLight) continue;

    for (const point of wall.points) {
      wallVertices.push({ point, wallId: wall.id });
    }
  }

  // Cast rays to each vertex and slightly offset angles
  for (const vertex of wallVertices) {
    const dx = vertex.point.x - origin.x;
    const dy = vertex.point.y - origin.y;
    const angle = Math.atan2(dy, dx);

    // Cast rays at vertex angle and small offsets to handle edge cases
    const offsetAngles = [angle - 0.00001, angle, angle + 0.00001];

    for (const testAngle of offsetAngles) {
      // Skip if we've already tested this angle (with some tolerance)
      const roundedAngle = Math.round(testAngle * 100000) / 100000;
      if (uniqueAngles.has(roundedAngle)) continue;
      uniqueAngles.add(roundedAngle);

      const direction = {
        x: Math.cos(testAngle),
        y: Math.sin(testAngle),
      };

      const intersection = raycastToWalls(origin, direction, walls, maxRange);

      if (intersection) {
        endpoints.push({
          point: intersection.point,
          angle: testAngle,
          distance: intersection.distance,
          isWallVertex: true,
          wallId: intersection.wallId,
        });
      } else {
        // No wall hit, extend to max range
        endpoints.push({
          point: {
            x: origin.x + direction.x * maxRange,
            y: origin.y + direction.y * maxRange,
          },
          angle: testAngle,
          distance: maxRange,
          isWallVertex: false,
        });
      }
    }
  }

  // If no walls, create a circle of endpoints
  if (endpoints.length === 0) {
    const numPoints = 32; // Circle approximation
    for (let i = 0; i < numPoints; i++) {
      const angle = (i / numPoints) * Math.PI * 2 - Math.PI;
      const direction = {
        x: Math.cos(angle),
        y: Math.sin(angle),
      };

      endpoints.push({
        point: {
          x: origin.x + direction.x * maxRange,
          y: origin.y + direction.y * maxRange,
        },
        angle,
        distance: maxRange,
        isWallVertex: false,
      });
    }
  }

  return endpoints;
}

/**
 * Sort points by angle around origin (clockwise from east)
 *
 * Used to order vision polygon vertices for proper rendering.
 *
 * @param origin - Center point
 * @param points - Points to sort
 * @returns Sorted array of points
 *
 * @example
 * ```ts
 * const sorted = sortPointsByAngle(tokenPos, visionPoints);
 * // Points now ordered clockwise
 * ```
 */
export function sortPointsByAngle(origin: Point2D, points: Point2D[]): Point2D[] {
  return points.slice().sort((a, b) => {
    const angleA = Math.atan2(a.y - origin.y, a.x - origin.x);
    const angleB = Math.atan2(b.y - origin.y, b.x - origin.x);
    return angleA - angleB;
  });
}

/**
 * Sort vision endpoints by angle
 *
 * Convenience wrapper for sorting VisionEndpoint arrays
 *
 * @param endpoints - Endpoints to sort
 * @returns Sorted endpoints
 */
export function sortEndpointsByAngle(endpoints: VisionEndpoint[]): VisionEndpoint[] {
  return endpoints.slice().sort((a, b) => a.angle - b.angle);
}

/**
 * Remove duplicate points within tolerance
 *
 * Prevents polygon calculation issues from near-duplicate vertices
 *
 * @param points - Array of points
 * @param tolerance - Distance tolerance (default: 0.1 pixels)
 * @returns Deduplicated points
 */
export function removeDuplicatePoints(points: Point2D[], tolerance: number = 0.1): Point2D[] {
  if (points.length === 0) return [];

  const unique: Point2D[] = [points[0]];

  for (let i = 1; i < points.length; i++) {
    const point = points[i];
    let isDuplicate = false;

    for (const existing of unique) {
      const dx = point.x - existing.x;
      const dy = point.y - existing.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < tolerance) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      unique.push(point);
    }
  }

  return unique;
}
