/**
 * Template Distance Utilities
 *
 * Extracted from template-calculations.ts.
 * Handles distance mathematical calculations on grid-based maps.
 */

import { FEET_PER_GRID_SQUARE } from './point-generators';

import type { Point2D } from '@/types/scene';

/**
 * Calculates Euclidean distance between two points
 */
export function euclideanDistance(p1: Point2D, p2: Point2D): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculates grid distance using D&D 5e rules (5-10-5 diagonal pattern)
 * @param p1 - First point in pixels
 * @param p2 - Second point in pixels
 * @param gridSize - Grid size in pixels
 * @returns Distance in feet
 */
export function gridDistance(p1: Point2D, p2: Point2D, gridSize: number): number {
  const dx = Math.abs(p2.x - p1.x) / gridSize;
  const dy = Math.abs(p2.y - p1.y) / gridSize;

  // Use the D&D 5e diagonal rule: every other diagonal costs 10 feet
  const straight = Math.abs(dx - dy);
  const diagonal = Math.min(dx, dy);

  // Count diagonals: alternate between 5ft and 10ft
  const fullDiagonalPairs = Math.floor(diagonal / 2);
  const remainingDiagonal = diagonal % 2;

  const diagonalDistance = fullDiagonalPairs * 15 + remainingDiagonal * 5;
  const straightDistance = straight * 5;

  return diagonalDistance + straightDistance;
}

/**
 * Calculates distance in feet between two points
 * @param p1 - First point in pixels
 * @param p2 - Second point in pixels
 * @param gridSize - Grid size in pixels
 * @param useGridDistance - Whether to use D&D grid distance rules
 * @returns Distance in feet
 */
export function calculateDistance(
  p1: Point2D,
  p2: Point2D,
  gridSize: number,
  useGridDistance: boolean = true,
): number {
  if (useGridDistance) {
    return gridDistance(p1, p2, gridSize);
  }

  const pixelDistance = euclideanDistance(p1, p2);
  return (pixelDistance / gridSize) * FEET_PER_GRID_SQUARE;
}
