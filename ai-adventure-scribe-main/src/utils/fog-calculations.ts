/**
 * Fog of War Calculations
 *
 * Utilities for calculating fog of war visibility, vision polygons,
 * and polygon operations (union, intersection, simplification).
 *
 * @module utils/fog-calculations
 */


import type { Point2D, VisionBlocker } from '@/types/scene';
import type { Token } from '@/types/token';

import { calculateDistance } from '@/utils/geometry';

// ===========================
// Types
// ===========================

/**
 * A polygon representing a revealed area
 */
export interface FogPolygon {
  id: string;
  points: Point2D[];
  timestamp: number;
  revealedBy?: string; // Token ID
}

/**
 * Fog state for a point
 */
export type FogState = 'revealed' | 'dim' | 'dark';

// ===========================
// Vision Polygon Calculation
// ===========================

/**
 * Calculate the revealed area polygon for a token based on its vision and walls
 *
 * Uses raycasting to create a visibility polygon that accounts for walls.
 * The polygon represents the area that should be revealed in the fog of war.
 *
 * @param token - The token whose vision to calculate
 * @param walls - Vision blocking elements
 * @param visionRange - Override vision range in feet (uses token's vision if not provided)
 * @param gridSize - Grid size in pixels (default 100)
 * @returns Polygon of revealed area
 *
 * @example
 * ```ts
 * const revealedArea = calculateRevealedArea(token, walls, 60);
 * ```
 */
export function calculateRevealedArea(
  token: Token,
  walls: VisionBlocker[],
  visionRange?: number,
  gridSize: number = 100,
): FogPolygon {
  const origin = { x: token.x, y: token.y };

  // Determine vision range
  let range = visionRange;
  if (!range) {
    // Use token's vision range
    if (!token.vision.enabled) {
      range = 0;
    } else {
      range = Math.max(
        token.vision.range || 0,
        token.vision.darkvision || 0,
        token.vision.blindsight || 0,
        token.vision.truesight || 0,
      );
    }
  }

  // Convert feet to pixels (5ft = gridSize)
  const rangeInPixels = (range / 5) * gridSize;

  // If no vision, return empty polygon
  if (rangeInPixels === 0) {
    return {
      id: `fog-${token.id}-${Date.now()}`,
      points: [],
      timestamp: Date.now(),
      revealedBy: token.id,
    };
  }

  // Calculate visibility polygon using raycasting
  const visibilityPolygon = calculateVisibilityPolygon(
    origin,
    rangeInPixels,
    walls,
    token.vision.angle,
  );

  return {
    id: `fog-${token.id}-${Date.now()}`,
    points: visibilityPolygon,
    timestamp: Date.now(),
    revealedBy: token.id,
  };
}

/**
 * Calculate visibility polygon using raycasting
 *
 * Casts rays from the origin in all directions, stopping at walls or max range.
 * Returns a polygon of the visible area.
 *
 * @param origin - The viewpoint origin
 * @param maxRange - Maximum vision range in pixels
 * @param walls - Vision blockers
 * @param visionAngle - Vision cone angle in degrees (360 for full circle)
 * @returns Array of points forming the visibility polygon
 */
export function calculateVisibilityPolygon(
  origin: Point2D,
  maxRange: number,
  walls: VisionBlocker[],
  visionAngle: number = 360,
): Point2D[] {
  // Collect all unique angles to cast rays
  const angles = new Set<number>();

  // Add angles for vision cone edges if not full circle
  if (visionAngle < 360) {
    const halfAngle = (visionAngle / 2) * (Math.PI / 180);
    angles.add(-halfAngle);
    angles.add(halfAngle);
  }

  // Add angles for wall endpoints
  walls.forEach((wall) => {
    wall.points.forEach((point) => {
      const dx = point.x - origin.x;
      const dy = point.y - origin.y;
      const angle = Math.atan2(dy, dx);

      // Add the angle and slight offsets to catch edges
      angles.add(angle);
      angles.add(angle - 0.0001);
      angles.add(angle + 0.0001);
    });
  });

  // If full circle, add rays at regular intervals
  const numRays = visionAngle >= 360 ? 64 : 32;
  for (let i = 0; i < numRays; i++) {
    const angle = ((i * 360) / numRays) * (Math.PI / 180);
    angles.add(angle);
  }

  // Cast rays and find intersections
  const points: Point2D[] = [];
  const sortedAngles = Array.from(angles).sort((a, b) => a - b);

  sortedAngles.forEach((angle) => {
    // Check if angle is within vision cone
    if (visionAngle < 360) {
      const halfAngle = (visionAngle / 2) * (Math.PI / 180);
      if (angle < -halfAngle || angle > halfAngle) {
        return;
      }
    }

    // Cast ray
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const rayEnd = {
      x: origin.x + dx * maxRange,
      y: origin.y + dy * maxRange,
    };

    // Find nearest intersection with walls
    let nearestIntersection = rayEnd;
    let minDistance = maxRange;

    walls.forEach((wall) => {
      if (!wall.blocksLight) return;

      // Check each segment of the wall
      for (let i = 0; i < wall.points.length - 1; i++) {
        const intersection = rayLineIntersection(
          origin,
          rayEnd,
          wall.points[i],
          wall.points[i + 1],
        );

        if (intersection) {
          const dist = calculateDistance(origin, intersection);
          if (dist < minDistance) {
            minDistance = dist;
            nearestIntersection = intersection;
          }
        }
      }

      // Check closing segment for polygons
      if (wall.points.length > 2) {
        const intersection = rayLineIntersection(
          origin,
          rayEnd,
          wall.points[wall.points.length - 1],
          wall.points[0],
        );

        if (intersection) {
          const dist = calculateDistance(origin, intersection);
          if (dist < minDistance) {
            minDistance = dist;
            nearestIntersection = intersection;
          }
        }
      }
    });

    points.push(nearestIntersection);
  });

  return points;
}

/**
 * Find intersection between a ray and a line segment
 *
 * @param rayOrigin - Ray starting point
 * @param rayEnd - Ray end point (defines direction)
 * @param segmentStart - Line segment start
 * @param segmentEnd - Line segment end
 * @returns Intersection point or null
 */
export function rayLineIntersection(
  rayOrigin: Point2D,
  rayEnd: Point2D,
  segmentStart: Point2D,
  segmentEnd: Point2D,
): Point2D | null {
  const r_px = rayOrigin.x;
  const r_py = rayOrigin.y;
  const r_dx = rayEnd.x - rayOrigin.x;
  const r_dy = rayEnd.y - rayOrigin.y;

  const s_px = segmentStart.x;
  const s_py = segmentStart.y;
  const s_dx = segmentEnd.x - segmentStart.x;
  const s_dy = segmentEnd.y - segmentStart.y;

  const denominator = r_dx * s_dy - r_dy * s_dx;

  if (Math.abs(denominator) < 0.0001) {
    return null; // Parallel
  }

  const t = ((s_px - r_px) * s_dy - (s_py - r_py) * s_dx) / denominator;
  const u = ((s_px - r_px) * r_dy - (s_py - r_py) * r_dx) / denominator;

  if (t >= 0 && u >= 0 && u <= 1) {
    return {
      x: r_px + t * r_dx,
      y: r_py + t * r_dy,
    };
  }

  return null;
}

// ===========================

// ===========================
// Polygon Operations
// ===========================

import {
  polygonBoundingBoxesOverlap,
  getPolygonBoundingBox,
  isPointInPolygon,
  simplifyPolygon,
  douglasPeucker,
  perpendicularDistance,
  calculatePolygonArea,
  createCircularPolygon,
  createRectangularPolygon,
  polygonToThreeShape,
} from '@/utils/polygon-utils';

export {
  isPointInPolygon,
  simplifyPolygon,
  douglasPeucker,
  calculatePolygonArea,
  createCircularPolygon,
  createRectangularPolygon,
  polygonToThreeShape,
};

/**
 * Merge multiple fog polygons into a simplified set
 *
 * Combines overlapping polygons to reduce complexity.
 * This is a simplified implementation - for production, consider using
 * a library like martinez-polygon-clipping or polygon-clipping.
 *
 * @param polygons - Array of polygons to merge
 * @returns Simplified array of merged polygons
 */
export function mergeFogPolygons(polygons: FogPolygon[]): FogPolygon[] {
  if (polygons.length === 0) return [];
  if (polygons.length === 1) return polygons;

  // For now, return all polygons (full implementation would use polygon union)
  // In production, use a library like:
  // import { union } from 'polygon-clipping';

  // Simple bounding box merge for performance
  const merged: FogPolygon[] = [];
  const used = new Set<number>();

  for (let i = 0; i < polygons.length; i++) {
    if (used.has(i)) continue;

    let currentPoly = polygons[i];
    let changed = true;

    while (changed) {
      changed = false;
      for (let j = i + 1; j < polygons.length; j++) {
        if (used.has(j)) continue;

        // Check if polygons overlap using bounding boxes
        if (polygonBoundingBoxesOverlap(currentPoly.points, polygons[j].points)) {
          // Merge by combining points (simplified - should use proper union)
          currentPoly = {
            ...currentPoly,
            points: [...currentPoly.points, ...polygons[j].points],
          };
          used.add(j);
          changed = true;
        }
      }
    }

    merged.push(currentPoly);
    used.add(i);
  }

  return merged;
}

/**
 * Check if a point is inside a revealed area
 *
 * Uses ray casting algorithm to determine if a point is inside a polygon.
 *
 * @param point - The point to check
 * @param revealedAreas - Array of revealed area polygons
 * @returns Whether the point is revealed
 */
export function isPointRevealed(point: Point2D, revealedAreas: FogPolygon[]): boolean {
  for (const area of revealedAreas) {
    if (isPointInPolygon(point, area.points)) {
      return true;
    }
  }
  return false;
}
