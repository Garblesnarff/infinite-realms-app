/**
 * Fog Raycasting Utilities
 *
 * Raycasting and visibility calculations for fog of war.
 * Extracted from fog-calculations.ts.
 *
 * @module utils/fog-raycasting
 */

import type { Point2D, VisionBlocker } from '@/types/scene';

import { calculateDistance } from '@/utils/geometry';

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
