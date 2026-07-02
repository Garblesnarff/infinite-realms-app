/**
 * Geometry primitives for quadtree wall-intersection tests.
 *
 * @module utils/spatial/geometry
 */

import type { AABB } from './aabb';
import type { Point2D, VisionBlocker } from '@/types/scene';

export function pointInBounds(point: Point2D, bounds: AABB): boolean {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  );
}

/**
 * Check if line segment intersects AABB.
 * Uses Liang-Barsky algorithm for efficiency.
 */
export function lineIntersectsBounds(p1: Point2D, p2: Point2D, bounds: AABB): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;

  const edges = [
    { p: -dx, q: p1.x - bounds.minX }, // Left
    { p: dx, q: bounds.maxX - p1.x }, // Right
    { p: -dy, q: p1.y - bounds.minY }, // Top
    { p: dy, q: bounds.maxY - p1.y }, // Bottom
  ];

  for (const edge of edges) {
    if (edge.p === 0) {
      if (edge.q < 0) return false; // Parallel and outside
    } else {
      const t = edge.q / edge.p;
      if (edge.p < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }

  return t0 <= t1;
}

export function boundsIntersect(a: AABB, b: AABB): boolean {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
}

export function wallIntersectsBounds(wall: VisionBlocker, bounds: AABB): boolean {
  // Check if any wall segment intersects the bounds
  for (const point of wall.points) {
    if (pointInBounds(point, bounds)) {
      return true;
    }
  }

  // Check if any edge of the wall crosses the bounds
  for (let i = 0; i < wall.points.length - 1; i++) {
    if (lineIntersectsBounds(wall.points[i], wall.points[i + 1], bounds)) {
      return true;
    }
  }

  // Check closing segment for polygons
  if (wall.points.length > 2) {
    if (lineIntersectsBounds(wall.points[wall.points.length - 1], wall.points[0], bounds)) {
      return true;
    }
  }

  return false;
}
