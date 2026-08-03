/**
 * Raycasting Advanced Utilities
 *
 * Extracted from raycasting.ts.
 * Advanced raycasting and geometric operations (cones, shadow calculations,
 * and reflections).
 *
 * @module utils/raycasting-advanced
 */

import { raycastToWalls, rayLineSegmentIntersection } from './raycasting-core';

import type { LineSegment, RayIntersection } from './raycasting-core';
import type { Point2D, VisionBlocker } from '@/types/scene';

// ===========================
// Line Segment Intersection
// ===========================

/**
 * Calculate exact intersection point between two line segments
 *
 * Returns the intersection point if segments intersect, null otherwise.
 * This is more precise than the boolean check in vision-calculations.ts
 *
 * @param line1 - First line segment
 * @param line2 - Second line segment
 * @returns Intersection point or null
 *
 * @example
 * ```ts
 * const intersection = lineSegmentIntersection(
 *   { start: {x: 0, y: 0}, end: {x: 10, y: 10} },
 *   { start: {x: 0, y: 10}, end: {x: 10, y: 0} }
 * );
 * // Returns {x: 5, y: 5}
 * ```
 */
export function lineSegmentIntersection(line1: LineSegment, line2: LineSegment): Point2D | null {
  const x1 = line1.start.x;
  const y1 = line1.start.y;
  const x2 = line1.end.x;
  const y2 = line1.end.y;
  const x3 = line2.start.x;
  const y3 = line2.start.y;
  const x4 = line2.end.x;
  const y4 = line2.end.y;

  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);

  if (Math.abs(denom) < 1e-10) {
    return null; // Parallel or coincident
  }

  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;

  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return {
      x: x1 + t * (x2 - x1),
      y: y1 + t * (y2 - y1),
    };
  }

  return null;
}

// ===========================
// Advanced Raycasting
// ===========================

/**
 * Cast multiple rays in a cone from origin
 *
 * Useful for vision cones with limited angle
 *
 * @param origin - Starting point
 * @param centerAngle - Center direction in radians
 * @param coneAngle - Total cone width in radians
 * @param numRays - Number of rays to cast
 * @param walls - Walls to test against
 * @param maxDistance - Maximum ray distance
 * @returns Array of intersections
 */
export function raycastCone(
  origin: Point2D,
  centerAngle: number,
  coneAngle: number,
  numRays: number,
  walls: VisionBlocker[],
  maxDistance: number = 1000,
): RayIntersection[] {
  const intersections: RayIntersection[] = [];
  const startAngle = centerAngle - coneAngle / 2;
  const angleStep = coneAngle / (numRays - 1);

  for (let i = 0; i < numRays; i++) {
    const angle = startAngle + i * angleStep;
    const direction = {
      x: Math.cos(angle),
      y: Math.sin(angle),
    };

    const hit = raycastToWalls(origin, direction, walls, maxDistance);
    if (hit) {
      intersections.push(hit);
    }
  }

  return intersections;
}

/**
 * Check if point is in shadow of wall relative to light source
 *
 * Used for shadow casting from light sources
 *
 * @param point - Point to test
 * @param lightSource - Light position
 * @param wall - Wall that might cast shadow
 * @returns Whether point is in shadow
 */
export function isInShadow(point: Point2D, lightSource: Point2D, wall: VisionBlocker): boolean {
  if (!wall.blocksLight) return false;

  // Check each segment of the wall
  for (let i = 0; i < wall.points.length - 1; i++) {
    const wallStart = wall.points[i];
    const wallEnd = wall.points[i + 1];

    // Ray from light to point
    const dx = point.x - lightSource.x;
    const dy = point.y - lightSource.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance === 0) continue;

    const direction = {
      x: dx / distance,
      y: dy / distance,
    };

    const intersection = rayLineSegmentIntersection(lightSource, direction, wallStart, wallEnd);

    if (intersection && intersection.distance < distance - 0.1) {
      return true; // Wall blocks light before reaching point
    }
  }

  return false;
}

/**
 * Calculate reflection vector for a ray hitting a surface
 *
 * Used for advanced lighting effects (mirrors, reflective surfaces)
 *
 * @param incident - Incident ray direction (normalized)
 * @param normal - Surface normal (normalized)
 * @returns Reflected ray direction
 */
export function calculateReflection(incident: Point2D, normal: Point2D): Point2D {
  // R = I - 2(I·N)N
  const dot = incident.x * normal.x + incident.y * normal.y;
  return {
    x: incident.x - 2 * dot * normal.x,
    y: incident.y - 2 * dot * normal.y,
  };
}
