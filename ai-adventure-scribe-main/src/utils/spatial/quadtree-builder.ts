/**
 * Recursive quadtree node construction and stats collection.
 *
 * @module utils/spatial/quadtree-builder
 */

import { wallIntersectsBounds } from './geometry';

import type { AABB } from './aabb';
import type { VisionBlocker } from '@/types/scene';

export interface QuadTreeNode {
  bounds: AABB;
  walls: VisionBlocker[];
  children: QuadTreeNode[] | null;
  level: number;
}

export interface QuadTreeConfig {
  maxWalls: number; // Max walls per node before splitting
  maxLevel: number; // Max tree depth
}

export interface QuadTreeStats {
  totalNodes: number;
  maxDepth: number;
  totalWalls: number;
  leafNodes: number;
  wallsInLeaves: number;
}

export function createQuadTreeNode(
  bounds: AABB,
  walls: VisionBlocker[],
  level: number,
  config: QuadTreeConfig,
): QuadTreeNode {
  const node: QuadTreeNode = {
    bounds,
    walls: [],
    children: null,
    level,
  };

  // Filter walls that intersect this node's bounds
  for (const wall of walls) {
    if (wallIntersectsBounds(wall, bounds)) {
      node.walls.push(wall);
    }
  }

  // Split if we have too many walls and haven't reached max depth
  if (node.walls.length > config.maxWalls && level < config.maxLevel) {
    splitQuadTreeNode(node, config);
  }

  return node;
}

function splitQuadTreeNode(node: QuadTreeNode, config: QuadTreeConfig): void {
  const { bounds, walls, level } = node;
  const midX = (bounds.minX + bounds.maxX) / 2;
  const midY = (bounds.minY + bounds.maxY) / 2;

  // Create four child quadrants
  const childBounds: AABB[] = [
    // Top-left
    { minX: bounds.minX, minY: bounds.minY, maxX: midX, maxY: midY },
    // Top-right
    { minX: midX, minY: bounds.minY, maxX: bounds.maxX, maxY: midY },
    // Bottom-left
    { minX: bounds.minX, minY: midY, maxX: midX, maxY: bounds.maxY },
    // Bottom-right
    { minX: midX, minY: midY, maxX: bounds.maxX, maxY: bounds.maxY },
  ];

  node.children = childBounds.map((childBound) =>
    createQuadTreeNode(childBound, walls, level + 1, config),
  );

  // Clear walls from parent node (they're now in children)
  // Keep reference to avoid recreating for query optimization
}

export function collectQuadTreeStats(node: QuadTreeNode, stats: QuadTreeStats): void {
  stats.totalNodes++;
  stats.maxDepth = Math.max(stats.maxDepth, node.level);

  if (!node.children) {
    // Leaf node
    stats.leafNodes++;
    stats.wallsInLeaves += node.walls.length;
  }

  // Count unique walls
  stats.totalWalls += node.walls.length;

  if (node.children) {
    for (const child of node.children) {
      collectQuadTreeStats(child, stats);
    }
  }
}
