/**
 * Advanced Vision Polygon Calculation
 *
 * Extracted from vision-calculations.ts
 *
 * Uses raycasting to all wall vertices to create a polygon representing
 * the area visible to a token. Handles walls, vision range, and vision cones.
 *
 * @module utils/vision-polygon
 */

import {
  isLineBlocked,
  isPointInVisionCone,
} from './geometry';
import {
  getAllRayIntersections,
  removeDuplicatePoints,
  sortEndpointsByAngle,
} from './raycasting';
import {
  calculateVisionRadius,
} from './vision-calculations';

import type { Point2D, VisionBlocker } from '@/types/scene';
import type { Token, TokenVisionConfig } from '@/types/token';

/**
 * Vision polygon calculation result
 */
export interface VisionPolygon {
  points: Point2D[];
  range: number;
  visionMode: TokenVisionConfig['visionMode'];
  coneAngle?: number;
  rotation?: number;
}

/**
 * Calculate the visible area polygon for a token
 *
 * Uses raycasting to all wall vertices to create a polygon representing
 * the area visible to a token. Handles walls, vision range, and vision cones.
 *
 * This is the core of the fog-of-war system. The returned polygon can be used
 * to clip the fog rendering and determine what the token can see.
 *
 * @param token - The token to calculate vision for
 * @param walls - Vision blocking walls
 * @param range - Vision range in pixels (overrides token vision if provided)
 * @returns Vision polygon with ordered vertices
 *
 * @example
 * ```ts
 * const polygon = calculateVisionPolygon(token, walls, 600);
 * // Use polygon.points for rendering
 * ```
 */
export function calculateVisionPolygon(
  token: Token,
  walls: VisionBlocker[],
  range?: number
): VisionPolygon {
  if (!token.vision.enabled) {
    return {
      points: [],
      range: 0,
      visionMode: token.vision.visionMode || 'basic',
    };
  }

  // Calculate effective range
  const visionRange = range !== undefined ? range : calculateVisionRadius(token) * 20; // Convert feet to pixels
  const origin: Point2D = { x: token.x, y: token.y };

  // Filter walls based on vision type
  const effectiveWalls = filterWallsByVisionType(token, walls);

  // Get all ray intersections
  const endpoints = getAllRayIntersections(origin, effectiveWalls, visionRange);

  // Sort by angle
  const sortedEndpoints = sortEndpointsByAngle(endpoints);

  // Extract points
  let points = sortedEndpoints.map((ep) => ep.point);

  // Handle vision cone (limited angle)
  if (token.vision.angle < 360) {
    points = clipPolygonToCone(
      points,
      origin,
      token.rotation,
      token.vision.angle,
      visionRange
    );
  }

  // Remove duplicate points
  points = removeDuplicatePoints(points);

  // Ensure polygon is closed
  if (points.length > 0) {
    const first = points[0];
    const last = points[points.length - 1];
    const dx = first.x - last.x;
    const dy = first.y - last.y;
    if (Math.sqrt(dx * dx + dy * dy) > 0.1) {
      points.push(first); // Close the polygon
    }
  }

  return {
    points,
    range: visionRange,
    visionMode: token.vision.visionMode || 'basic',
    coneAngle: token.vision.angle < 360 ? token.vision.angle : undefined,
    rotation: token.vision.angle < 360 ? token.rotation : undefined,
  };
}

/**
 * Filter walls based on token's vision type
 *
 * Some vision types (blindsight, truesight) can see through certain walls
 *
 * @param token - Token with vision
 * @param walls - All walls
 * @returns Filtered walls that block this token's vision
 */
function filterWallsByVisionType(
  token: Token,
  walls: VisionBlocker[]
): VisionBlocker[] {
  const visionType = token.vision.visionMode || 'basic';

  // Truesight and blindsight ignore transparent walls
  if (visionType === 'truesight' || visionType === 'blindsight') {
    return walls.filter((wall) => wall.blocksLight && wall.blocksMovement);
  }

  // Tremorsense ignores walls entirely (but has limited range)
  if (visionType === 'tremorsense') {
    return [];
  }

  // Normal vision respects all light-blocking walls
  return walls.filter((wall) => wall.blocksLight);
}

/**
 * Clip a polygon to a vision cone
 *
 * @param points - Polygon points
 * @param origin - Cone origin
 * @param rotation - Cone center direction (degrees)
 * @param angle - Cone width (degrees)
 * @param maxRange - Maximum distance
 * @returns Clipped polygon points
 */
function clipPolygonToCone(
  points: Point2D[],
  origin: Point2D,
  rotation: number,
  angle: number,
  maxRange: number
): Point2D[] {
  const clipped: Point2D[] = [];
  const halfAngle = (angle / 2) * (Math.PI / 180);
  const centerAngle = rotation * (Math.PI / 180);

  // Add cone edges
  const startAngle = centerAngle - halfAngle;
  const endAngle = centerAngle + halfAngle;

  // Starting edge of cone
  clipped.push({
    x: origin.x + Math.cos(startAngle) * maxRange,
    y: origin.y + Math.sin(startAngle) * maxRange,
  });

  // Add points that are within the cone
  for (const point of points) {
    if (isPointInVisionCone(origin, rotation, angle, point)) {
      clipped.push(point);
    }
  }

  // Ending edge of cone
  clipped.push({
    x: origin.x + Math.cos(endAngle) * maxRange,
    y: origin.y + Math.sin(endAngle) * maxRange,
  });

  // Add origin to close the cone
  clipped.push(origin);

  return clipped;
}

/**
 * Optimize hasLineOfSight using spatial partitioning
 *
 * Enhanced version of isLineBlocked that uses quadtree for better performance
 *
 * @param from - Start point
 * @param to - End point
 * @param walls - All walls (will be spatially partitioned)
 * @param quadTree - Optional pre-built quadtree for performance
 * @returns Whether line of sight exists
 */
export function hasLineOfSight(
  from: Point2D,
  to: Point2D,
  walls: VisionBlocker[],
  quadTree?: { queryLine: (from: Point2D, to: Point2D) => VisionBlocker[] } // Use structural typing to avoid circular dependency
): boolean {
  if (quadTree) {
    // Use spatial partitioning for efficient queries
    const relevantWalls = quadTree.queryLine(from, to);
    return !isLineBlocked(from, to, relevantWalls);
  }

  // Fallback to checking all walls
  return !isLineBlocked(from, to, walls);
}

/**
 * Merge multiple vision polygons into one
 *
 * Used when multiple tokens need to share vision (party mode)
 *
 * @param polygons - Array of vision polygons
 * @returns Merged polygon
 */
export function mergeVisionPolygons(polygons: VisionPolygon[]): VisionPolygon {
  if (polygons.length === 0) {
    return {
      points: [],
      range: 0,
      visionMode: 'basic',
    };
  }

  if (polygons.length === 1) {
    return polygons[0];
  }

  // Simple union: collect all points and use convex hull
  // For production, use a proper polygon union algorithm
  const allPoints: Point2D[] = [];
  let maxRange = 0;

  for (const polygon of polygons) {
    allPoints.push(...polygon.points);
    maxRange = Math.max(maxRange, polygon.range);
  }

  // Use convex hull as simple approximation
  const merged = convexHull(allPoints);

  return {
    points: merged,
    range: maxRange,
    visionMode: 'basic', // Merged vision uses basic mode
  };
}

/**
 * Calculate convex hull of points (Graham scan algorithm)
 *
 * @param points - Input points
 * @returns Convex hull points in counter-clockwise order
 */
function convexHull(points: Point2D[]): Point2D[] {
  if (points.length < 3) return points;

  // Find bottom-most point (or left-most if tie)
  let start = points[0];
  for (const point of points) {
    if (point.y < start.y || (point.y === start.y && point.x < start.x)) {
      start = point;
    }
  }

  // Sort by polar angle with respect to start point
  const sorted = points.slice().sort((a, b) => {
    if (a === start) return -1;
    if (b === start) return 1;

    const angleA = Math.atan2(a.y - start.y, a.x - start.x);
    const angleB = Math.atan2(b.y - start.y, b.x - start.x);

    return angleA - angleB;
  });

  const hull: Point2D[] = [sorted[0], sorted[1]];

  for (let i = 2; i < sorted.length; i++) {
    let top = hull.pop()!;

    while (hull.length > 0 && ccw(hull[hull.length - 1], top, sorted[i]) <= 0) {
      top = hull.pop()!;
    }

    hull.push(top);
    hull.push(sorted[i]);
  }

  return hull;
}

/**
 * Counter-clockwise test for three points
 *
 * @param a - First point
 * @param b - Second point
 * @param c - Third point
 * @returns Positive if CCW, negative if CW, zero if collinear
 */
function ccw(a: Point2D, b: Point2D, c: Point2D): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}
