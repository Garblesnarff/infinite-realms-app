/**
 * Polygon Utilities
 *
 * Low-level polygon and geometry utilities for spatial calculations.
 * Extracted from fog-calculations.ts.
 *
 * @module utils/polygon-utils
 */

import type { Point2D } from '@/types/scene';

/**
 * Get bounding box of a polygon
 *
 * @param points - Polygon points
 * @returns Bounding box with min/max X/Y
 */
export function getPolygonBoundingBox(points: Point2D[]) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);

  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

/**
 * Check if two polygon bounding boxes overlap
 *
 * @param points1 - First polygon points
 * @param points2 - Second polygon points
 * @returns Whether the bounding boxes overlap
 */
export function polygonBoundingBoxesOverlap(points1: Point2D[], points2: Point2D[]): boolean {
  if (points1.length === 0 || points2.length === 0) return false;

  const bbox1 = getPolygonBoundingBox(points1);
  const bbox2 = getPolygonBoundingBox(points2);

  return !(
    bbox1.maxX < bbox2.minX ||
    bbox1.minX > bbox2.maxX ||
    bbox1.maxY < bbox2.minY ||
    bbox1.minY > bbox2.maxY
  );
}

/**
 * Check if a point is inside a polygon using ray casting
 *
 * @param point - The point to test
 * @param polygon - The polygon vertices
 * @returns Whether the point is inside the polygon
 */
export function isPointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
  if (polygon.length < 3) return false;

  let inside = false;
  const x = point.x;
  const y = point.y;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;

    if (intersect) inside = !inside;
  }

  return inside;
}

/**
 * Simplify a polygon by removing colinear points
 *
 * Reduces the number of points in a polygon while maintaining its shape.
 *
 * @param points - Polygon points
 * @param tolerance - Tolerance for colinearity (in pixels)
 * @returns Simplified polygon
 */
export function simplifyPolygon(points: Point2D[], tolerance: number = 1.0): Point2D[] {
  if (points.length < 3) return points;

  const simplified: Point2D[] = [points[0]];

  for (let i = 1; i < points.length - 1; i++) {
    const prev = simplified[simplified.length - 1];
    const curr = points[i];
    const next = points[i + 1];

    // Calculate cross product to check colinearity
    const cross = (curr.x - prev.x) * (next.y - prev.y) - (curr.y - prev.y) * (next.x - prev.x);

    if (Math.abs(cross) > tolerance) {
      simplified.push(curr);
    }
  }

  // Always include the last point
  simplified.push(points[points.length - 1]);

  return simplified;
}

/**
 * Calculate perpendicular distance from point to line
 *
 * @param point - The point to measure from
 * @param lineStart - Start of the line
 * @param lineEnd - End of the line
 * @returns Distance in pixels
 */
export function perpendicularDistance(point: Point2D, lineStart: Point2D, lineEnd: Point2D): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;

  // Handle degenerate case where line is a point
  if (dx === 0 && dy === 0) {
    return Math.sqrt(Math.pow(point.x - lineStart.x, 2) + Math.pow(point.y - lineStart.y, 2));
  }

  // Calculate perpendicular distance using cross product
  const numerator = Math.abs(
    dy * point.x - dx * point.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x,
  );
  const denominator = Math.sqrt(dx * dx + dy * dy);

  return numerator / denominator;
}

/**
 * Simplify a polygon using Douglas-Peucker algorithm
 *
 * More sophisticated simplification that maintains shape better than
 * simple colinearity checking.
 *
 * @param points - Polygon points
 * @param epsilon - Maximum distance threshold (in pixels)
 * @returns Simplified polygon
 */
export function douglasPeucker(points: Point2D[], epsilon: number = 2.0): Point2D[] {
  if (points.length < 3) return points;

  // Find the point with maximum distance from line between first and last
  let maxDistance = 0;
  let maxIndex = 0;
  const end = points.length - 1;

  for (let i = 1; i < end; i++) {
    const distance = perpendicularDistance(points[i], points[0], points[end]);
    if (distance > maxDistance) {
      maxDistance = distance;
      maxIndex = i;
    }
  }

  // If max distance is greater than epsilon, recursively simplify
  if (maxDistance > epsilon) {
    // Recursive call
    const leftSegment = douglasPeucker(points.slice(0, maxIndex + 1), epsilon);
    const rightSegment = douglasPeucker(points.slice(maxIndex), epsilon);

    // Combine results (remove duplicate middle point)
    return [...leftSegment.slice(0, -1), ...rightSegment];
  } else {
    // Base case: just return endpoints
    return [points[0], points[end]];
  }
}

/**
 * Calculate the area of a polygon
 *
 * @param points - Polygon vertices
 * @returns Area in square pixels
 */
export function calculatePolygonArea(points: Point2D[]): number {
  if (points.length < 3) return 0;

  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }

  return Math.abs(area / 2);
}

/**
 * Create a circular revealed area polygon
 *
 * Helper for manual fog reveals with brush tool.
 *
 * @param center - Center point
 * @param radius - Radius in pixels
 * @param segments - Number of segments (default 32)
 * @returns Circular polygon
 */
export function createCircularPolygon(
  center: Point2D,
  radius: number,
  segments: number = 32,
): Point2D[] {
  const points: Point2D[] = [];

  for (let i = 0; i < segments; i++) {
    const angle = (i * 2 * Math.PI) / segments;
    points.push({
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    });
  }

  return points;
}

/**
 * Create a rectangular revealed area polygon
 *
 * @param topLeft - Top-left corner
 * @param width - Width in pixels
 * @param height - Height in pixels
 * @returns Rectangular polygon
 */
export function createRectangularPolygon(
  topLeft: Point2D,
  width: number,
  height: number,
): Point2D[] {
  return [
    topLeft,
    { x: topLeft.x + width, y: topLeft.y },
    { x: topLeft.x + width, y: topLeft.y + height },
    { x: topLeft.x, y: topLeft.y + height },
  ];
}

/**
 * Convert a polygon to a THREE.Shape for rendering
 *
 * @param points - Polygon points
 * @returns Points suitable for THREE.Shape
 */
export function polygonToThreeShape(points: Point2D[]): Array<[number, number]> {
  return points.map((p) => [p.x, p.y]);
}
