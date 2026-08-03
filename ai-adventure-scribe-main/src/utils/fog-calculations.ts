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

import { calculateVisibilityPolygon, rayLineIntersection } from '@/utils/fog-raycasting';
import {
  polygonBoundingBoxesOverlap,
  isPointInPolygon,
  simplifyPolygon,
  douglasPeucker,
  calculatePolygonArea,
  createCircularPolygon,
  createRectangularPolygon,
  polygonToThreeShape,
} from '@/utils/polygon-utils';

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

// Re-export raycasting utilities for backward compatibility
export { calculateVisibilityPolygon, rayLineIntersection };

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
