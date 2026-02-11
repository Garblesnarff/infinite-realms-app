/**
 * Geometry Utilities
 *
 * Core mathematical utilities for 2D geometry, intersections, and spatial checks.
 * Extracted from vision-calculations.ts to centralize geometric logic.
 *
 * @module utils/geometry
 */

import type { Point2D, VisionBlocker } from '@/types/scene';


/**
 * Calculate Euclidean distance between two points
 *
 * @param a - First point
 * @param b - Second point
 * @returns Distance in pixels
 */
export function calculateDistance(a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Check if a point is within a vision cone
 *
 * @param origin - The origin of the cone
 * @param rotation - The rotation/facing of the cone in degrees
 * @param angle - The width of the cone in degrees
 * @param target - The point to check
 * @returns Whether the point is in the cone
 */
export function isPointInVisionCone(
  origin: Point2D,
  rotation: number,
  angle: number,
  target: Point2D
): boolean {
  // Full circle vision
  if (angle >= 360) {
    return true;
  }

  // Calculate angle to target
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const angleToTarget = Math.atan2(dy, dx) * (180 / Math.PI);

  // Normalize angles
  const normalizedRotation = ((rotation % 360) + 360) % 360;
  const normalizedTargetAngle = ((angleToTarget % 360) + 360) % 360;

  // Calculate angle difference
  let diff = Math.abs(normalizedTargetAngle - normalizedRotation);
  if (diff > 180) {
    diff = 360 - diff;
  }

  // Check if within cone
  return diff <= angle / 2;
}

/**
 * Check if two line segments intersect
 *
 * @param a1 - First point of line A
 * @param a2 - Second point of line A
 * @param b1 - First point of line B
 * @param b2 - Second point of line B
 * @returns Whether the line segments intersect
 */
export function lineSegmentsIntersect(
  a1: Point2D,
  a2: Point2D,
  b1: Point2D,
  b2: Point2D
): boolean {
  const det = (a2.x - a1.x) * (b2.y - b1.y) - (b2.x - b1.x) * (a2.y - a1.y);

  if (det === 0) {
    return false; // Parallel lines
  }

  const lambda = ((b2.y - b1.y) * (b2.x - a1.x) + (b1.x - b2.x) * (b2.y - a1.y)) / det;
  const gamma = ((a1.y - a2.y) * (b2.x - a1.x) + (a2.x - a1.x) * (b2.y - a1.y)) / det;

  return lambda > 0 && lambda < 1 && gamma > 0 && gamma < 1;
}

/**
 * Check if a line between two points is blocked by walls
 *
 * Uses line segment intersection to check if any wall blocks the line of sight.
 *
 * @param from - Start point
 * @param to - End point
 * @param walls - Vision blocking elements
 * @returns Whether the line is blocked
 */
export function isLineBlocked(
  from: Point2D,
  to: Point2D,
  walls: VisionBlocker[]
): boolean {
  for (const wall of walls) {
    if (!wall.blocksLight) {
      continue;
    }

    // Check each segment of the wall
    for (let i = 0; i < wall.points.length - 1; i++) {
      const wallStart = wall.points[i];
      const wallEnd = wall.points[i + 1];

      if (lineSegmentsIntersect(from, to, wallStart, wallEnd)) {
        return true;
      }
    }

    // Check closing segment if wall is a polygon
    if (wall.points.length > 2) {
      const wallStart = wall.points[wall.points.length - 1];
      const wallEnd = wall.points[0];

      if (lineSegmentsIntersect(from, to, wallStart, wallEnd)) {
        return true;
      }
    }
  }

  return false;
}
