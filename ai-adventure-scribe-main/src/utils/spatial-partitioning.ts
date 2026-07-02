/**
 * Spatial Partitioning Utilities
 *
 * Quadtree implementation for efficient spatial queries on walls and tokens.
 * Dramatically improves performance when checking line-of-sight against many walls.
 *
 * @module utils/spatial-partitioning
 */

import {
  type AABB,
  calculateWallBounds,
  createBoundsFromRadius,
  expandBounds,
  boundsContainsPoint,
  mergeBounds,
} from './spatial/aabb';
import { boundsIntersect, wallIntersectsBounds } from './spatial/geometry';
import {
  type QuadTreeNode,
  type QuadTreeConfig,
  type QuadTreeStats,
  createQuadTreeNode,
  collectQuadTreeStats,
} from './spatial/quadtree-builder';

import type { Point2D, VisionBlocker } from '@/types/scene';

// Re-export for backward compatibility
export {
  type AABB,
  calculateWallBounds,
  createBoundsFromRadius,
  expandBounds,
  boundsContainsPoint,
  mergeBounds,
  type QuadTreeNode,
  type QuadTreeConfig,
};

// ===========================
// Default Configuration
// ===========================

const DEFAULT_QUADTREE_CONFIG: QuadTreeConfig = {
  maxWalls: 10,
  maxLevel: 8,
};

// ===========================
// QuadTree Class
// ===========================

/**
 * QuadTree for spatial partitioning of walls
 *
 * Organizes walls into a hierarchical grid structure for O(log n) queries.
 * Significantly faster than checking all walls for every line-of-sight calculation.
 *
 * @example
 * ```ts
 * const quadTree = new QuadTree(bounds, walls);
 * const nearbyWalls = quadTree.query({ minX: 90, minY: 90, maxX: 110, maxY: 110 });
 * // Only returns walls near (100, 100)
 * ```
 */
export class QuadTree {
  private root: QuadTreeNode;
  private config: QuadTreeConfig;

  constructor(bounds: AABB, walls: VisionBlocker[], config: Partial<QuadTreeConfig> = {}) {
    this.config = { ...DEFAULT_QUADTREE_CONFIG, ...config };
    this.root = createQuadTreeNode(bounds, walls, 0, this.config);
  }

  /**
   * Query the quadtree for walls within a bounding box
   *
   * @param bounds - Query bounding box
   * @returns Walls that intersect the query bounds
   */
  query(bounds: AABB): VisionBlocker[] {
    const result: VisionBlocker[] = [];
    const seen = new Set<string>();

    this.queryNode(this.root, bounds, result, seen);

    return result;
  }

  /**
   * Query for walls near a point within a radius
   *
   * @param point - Center point
   * @param radius - Search radius in pixels
   * @returns Walls within radius
   */
  queryRadius(point: Point2D, radius: number): VisionBlocker[] {
    return this.query({
      minX: point.x - radius,
      minY: point.y - radius,
      maxX: point.x + radius,
      maxY: point.y + radius,
    });
  }

  /**
   * Query for walls along a line segment
   *
   * @param start - Line start point
   * @param end - Line end point
   * @param padding - Extra padding around line (default: 1)
   * @returns Walls that might intersect the line
   */
  queryLine(start: Point2D, end: Point2D, padding: number = 1): VisionBlocker[] {
    const bounds: AABB = {
      minX: Math.min(start.x, end.x) - padding,
      minY: Math.min(start.y, end.y) - padding,
      maxX: Math.max(start.x, end.x) + padding,
      maxY: Math.max(start.y, end.y) + padding,
    };

    return this.query(bounds);
  }

  /**
   * Rebuild the entire quadtree with new walls
   *
   * Call this when walls are added, removed, or modified
   *
   * @param walls - Updated wall list
   * @param padding - Optional padding if recalculating bounds (default: 100)
   */
  rebuild(walls: VisionBlocker[], padding: number = 100): void {
    const newBounds = calculateWallBounds(walls, padding);
    this.root = createQuadTreeNode(newBounds, walls, 0, this.config);
  }

  /**
   * Get statistics about the quadtree
   *
   * Useful for debugging and optimization
   *
   * @returns Tree statistics
   */
  getStats(): {
    totalNodes: number;
    maxDepth: number;
    totalWalls: number;
    avgWallsPerLeaf: number;
  } {
    const stats: QuadTreeStats = {
      totalNodes: 0,
      maxDepth: 0,
      totalWalls: 0,
      leafNodes: 0,
      wallsInLeaves: 0,
    };

    collectQuadTreeStats(this.root, stats);

    return {
      totalNodes: stats.totalNodes,
      maxDepth: stats.maxDepth,
      totalWalls: stats.totalWalls,
      avgWallsPerLeaf: stats.leafNodes > 0 ? stats.wallsInLeaves / stats.leafNodes : 0,
    };
  }

  // ===========================
  // Private Methods
  // ===========================

  private queryNode(
    node: QuadTreeNode,
    queryBounds: AABB,
    result: VisionBlocker[],
    seen: Set<string>,
  ): void {
    // Check if query bounds intersect this node
    if (!boundsIntersect(node.bounds, queryBounds)) {
      return;
    }

    // Add walls from this node
    for (const wall of node.walls) {
      if (!seen.has(wall.id)) {
        if (wallIntersectsBounds(wall, queryBounds)) {
          seen.add(wall.id);
          result.push(wall);
        }
      }
    }

    // Recursively query children
    if (node.children) {
      for (const child of node.children) {
        this.queryNode(child, queryBounds, result, seen);
      }
    }
  }
}

// ===========================
// Helper Functions
// ===========================

/**
 * Build a quadtree from an array of walls
 *
 * Automatically calculates bounds from wall positions
 *
 * @param walls - Walls to index
 * @param padding - Extra padding around bounds (default: 100)
 * @param config - Quadtree configuration
 * @returns Quadtree instance
 *
 * @example
 * ```ts
 * const quadTree = buildQuadTree(sceneWalls);
 * ```
 */
export function buildQuadTree(
  walls: VisionBlocker[],
  padding: number = 100,
  config?: Partial<QuadTreeConfig>,
): QuadTree {
  const bounds = calculateWallBounds(walls, padding);
  return new QuadTree(bounds, walls, config);
}
