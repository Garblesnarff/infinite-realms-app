import type { Point2D, VisionBlocker } from '@/types/scene';

/**
 * Axis-aligned bounding box
 */
export interface AABB {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Calculate bounding box encompassing all walls
 *
 * @param walls - Walls to bound
 * @param padding - Extra padding
 * @returns Bounding box
 */
export function calculateWallBounds(walls: VisionBlocker[], padding: number = 0): AABB {
  if (walls.length === 0) {
    return {
      minX: -padding,
      minY: -padding,
      maxX: padding,
      maxY: padding,
    };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const wall of walls) {
    for (const point of wall.points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }

  return {
    minX: minX - padding,
    minY: minY - padding,
    maxX: maxX + padding,
    maxY: maxY + padding,
  };
}

/**
 * Create bounding box from point and radius
 *
 * @param center - Center point
 * @param radius - Radius in pixels
 * @returns Bounding box
 */
export function createBoundsFromRadius(center: Point2D, radius: number): AABB {
  return {
    minX: center.x - radius,
    minY: center.y - radius,
    maxX: center.x + radius,
    maxY: center.y + radius,
  };
}

/**
 * Expand bounding box by amount
 *
 * @param bounds - Original bounds
 * @param amount - Amount to expand
 * @returns Expanded bounds
 */
export function expandBounds(bounds: AABB, amount: number): AABB {
  return {
    minX: bounds.minX - amount,
    minY: bounds.minY - amount,
    maxX: bounds.maxX + amount,
    maxY: bounds.maxY + amount,
  };
}

/**
 * Check if bounds contains a point
 *
 * @param bounds - Bounding box
 * @param point - Point to test
 * @returns Whether point is inside bounds
 */
export function boundsContainsPoint(bounds: AABB, point: Point2D): boolean {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  );
}

/**
 * Merge multiple bounding boxes
 *
 * @param boundsList - Array of bounding boxes
 * @returns Merged bounding box
 */
export function mergeBounds(boundsList: AABB[]): AABB {
  if (boundsList.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const bounds of boundsList) {
    minX = Math.min(minX, bounds.minX);
    minY = Math.min(minY, bounds.minY);
    maxX = Math.max(maxX, bounds.maxX);
    maxY = Math.max(maxY, bounds.maxY);
  }

  return { minX, minY, maxX, maxY };
}
