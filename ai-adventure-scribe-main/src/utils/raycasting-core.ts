/**
 * Raycasting Core Utilities
 *
 * Core geometric data structures and ray-wall intersection algorithms
 * for vision calculations.
 *
 * @module utils/raycasting-core
 */

import type { Point2D, VisionBlocker } from '@/types/scene';

// ===========================
// Types
// ===========================

/**
 * Line segment defined by two points
 */
export interface LineSegment {
  start: Point2D;
  end: Point2D;
}

/**
 * Ray defined by origin and direction
 */
export interface Ray {
  origin: Point2D;
  direction: Point2D; // Normalized direction vector
}

/**
 * Intersection result with detailed information
 */
export interface RayIntersection {
  point: Point2D;
  distance: number;
  wallId: string;
  segmentIndex: number;
  normal?: Point2D; // Surface normal at intersection
}

// ===========================
// Core Raycasting Functions
// ===========================

/**
 * Cast a ray from origin in direction and find the first wall intersection
 *
 * Uses efficient ray-line segment intersection algorithm with early exit optimization.
 *
 * @param origin - Starting point of the ray
 * @param direction - Direction vector (will be normalized)
 * @param walls - Vision blocking walls to test against
 * @param maxDistance - Maximum ray distance (default: Infinity)
 * @returns Intersection data or null if no intersection
 */
export function raycastToWalls(
  origin: Point2D,
  direction: Point2D,
  walls: VisionBlocker[],
  maxDistance: number = Infinity,
): RayIntersection | null {
  // Normalize direction
  const dirLength = Math.sqrt(direction.x * direction.x + direction.y * direction.y);
  if (dirLength === 0) return null;

  const normalizedDir = {
    x: direction.x / dirLength,
    y: direction.y / dirLength,
  };

  let closestIntersection: RayIntersection | null = null;
  let closestDistance = maxDistance;

  for (const wall of walls) {
    if (!wall.blocksLight) continue;

    // Check each segment of the wall
    for (let i = 0; i < wall.points.length - 1; i++) {
      const intersection = rayLineSegmentIntersection(
        origin,
        normalizedDir,
        wall.points[i],
        wall.points[i + 1],
      );

      if (intersection && intersection.distance < closestDistance) {
        closestDistance = intersection.distance;
        closestIntersection = {
          ...intersection,
          wallId: wall.id,
          segmentIndex: i,
        };
      }
    }

    // Check closing segment if wall forms a polygon
    if (wall.points.length > 2) {
      const intersection = rayLineSegmentIntersection(
        origin,
        normalizedDir,
        wall.points[wall.points.length - 1],
        wall.points[0],
      );

      if (intersection && intersection.distance < closestDistance) {
        closestDistance = intersection.distance;
        closestIntersection = {
          ...intersection,
          wallId: wall.id,
          segmentIndex: wall.points.length - 1,
        };
      }
    }
  }

  return closestIntersection;
}

/**
 * Calculate intersection between ray and line segment
 *
 * Uses parametric form for efficient calculation:
 * Ray: P = origin + t * direction
 * Line: P = start + s * (end - start)
 *
 * @param origin - Ray origin
 * @param direction - Ray direction (should be normalized)
 * @param segmentStart - Line segment start point
 * @param segmentEnd - Line segment end point
 * @returns Intersection with distance or null
 */
export function rayLineSegmentIntersection(
  origin: Point2D,
  direction: Point2D,
  segmentStart: Point2D,
  segmentEnd: Point2D,
): { point: Point2D; distance: number; normal: Point2D } | null {
  const dx = segmentEnd.x - segmentStart.x;
  const dy = segmentEnd.y - segmentStart.y;

  const det = dx * direction.y - dy * direction.x;

  // Parallel or coincident
  if (Math.abs(det) < 1e-10) {
    return null;
  }

  const u =
    ((segmentStart.y - origin.y) * direction.x - (segmentStart.x - origin.x) * direction.y) / det;
  const t = ((segmentStart.y - origin.y) * dx - (segmentStart.x - origin.x) * dy) / det;

  // Check if intersection is within segment and ray
  if (u >= 0 && u <= 1 && t >= 0) {
    const point = {
      x: origin.x + t * direction.x,
      y: origin.y + t * direction.y,
    };

    // Calculate surface normal (perpendicular to wall segment)
    const segmentLength = Math.sqrt(dx * dx + dy * dy);
    const normal = {
      x: -dy / segmentLength,
      y: dx / segmentLength,
    };

    return {
      point,
      distance: t,
      normal,
    };
  }

  return null;
}
