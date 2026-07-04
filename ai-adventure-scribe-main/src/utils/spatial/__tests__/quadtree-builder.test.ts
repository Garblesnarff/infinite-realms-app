import { describe, it, expect } from 'vitest';

import { createQuadTreeNode, collectQuadTreeStats } from '../quadtree-builder';

import type { AABB } from '../aabb';
import type { QuadTreeConfig, QuadTreeStats } from '../quadtree-builder';
import type { VisionBlocker } from '@/types/scene';

describe('quadtree-builder utils', () => {
  const bounds: AABB = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const config: QuadTreeConfig = { maxWalls: 2, maxLevel: 2 };

  const mockWalls: VisionBlocker[] = [
    { id: 'w1', points: [{ x: 10, y: 10 }, { x: 20, y: 20 }], blocksLight: true, blocksMovement: true },
    { id: 'w2', points: [{ x: 80, y: 80 }, { x: 90, y: 90 }], blocksLight: true, blocksMovement: true },
    { id: 'w3', points: [{ x: 10, y: 80 }, { x: 20, y: 90 }], blocksLight: true, blocksMovement: true },
    { id: 'w4', points: [{ x: 80, y: 10 }, { x: 90, y: 20 }], blocksLight: true, blocksMovement: true },
  ];

  describe('createQuadTreeNode', () => {
    it('should create a leaf node if wall count is below maxWalls', () => {
      const node = createQuadTreeNode(bounds, [mockWalls[0]], 0, config);
      expect(node.walls).toHaveLength(1);
      expect(node.children).toBeNull();
      expect(node.level).toBe(0);
    });

    it('should split node if wall count exceeds maxWalls', () => {
      const node = createQuadTreeNode(bounds, mockWalls, 0, config);
      expect(node.children).toHaveLength(4);
      expect(node.level).toBe(0);

      // Verify walls are distributed to children
      // Top-left (0,0 to 50,50) should have w1
      expect(node.children![0].walls.some(w => w.id === 'w1')).toBe(true);
      // Top-right (50,0 to 100,50) should have w4
      expect(node.children![1].walls.some(w => w.id === 'w4')).toBe(true);
      // Bottom-left (0,50 to 50,100) should have w3
      expect(node.children![2].walls.some(w => w.id === 'w3')).toBe(true);
      // Bottom-right (50,50 to 100,100) should have w2
      expect(node.children![3].walls.some(w => w.id === 'w2')).toBe(true);
    });

    it('should respect maxLevel depth limit', () => {
      const tightConfig: QuadTreeConfig = { maxWalls: 1, maxLevel: 1 };
      const node = createQuadTreeNode(bounds, mockWalls, 0, tightConfig);

      expect(node.level).toBe(0);
      expect(node.children).not.toBeNull();
      // Children are level 1, they should not split further even if they have > 1 wall
      expect(node.children![0].level).toBe(1);
      expect(node.children![0].children).toBeNull();
    });

    it('should only include walls that intersect node bounds', () => {
      const smallBounds: AABB = { minX: 0, minY: 0, maxX: 30, maxY: 30 };
      const node = createQuadTreeNode(smallBounds, mockWalls, 0, config);
      // Only w1 is in [0,30]x[0,30]
      expect(node.walls).toHaveLength(1);
      expect(node.walls[0].id).toBe('w1');
    });
  });

  describe('collectQuadTreeStats', () => {
    it('should correctly collect stats for a single node', () => {
      const node = createQuadTreeNode(bounds, [mockWalls[0]], 0, config);
      const stats: QuadTreeStats = { totalNodes: 0, maxDepth: 0, totalWalls: 0, leafNodes: 0, wallsInLeaves: 0 };

      collectQuadTreeStats(node, stats);

      expect(stats.totalNodes).toBe(1);
      expect(stats.maxDepth).toBe(0);
      expect(stats.totalWalls).toBe(1);
      expect(stats.leafNodes).toBe(1);
      expect(stats.wallsInLeaves).toBe(1);
    });

    it('should correctly collect stats for a split tree', () => {
      const node = createQuadTreeNode(bounds, mockWalls, 0, config);
      const stats: QuadTreeStats = { totalNodes: 0, maxDepth: 0, totalWalls: 0, leafNodes: 0, wallsInLeaves: 0 };

      collectQuadTreeStats(node, stats);

      // Root node + 4 children = 5 nodes
      expect(stats.totalNodes).toBe(5);
      expect(stats.maxDepth).toBe(1);
      // totalWalls counts walls in every node.
      // Root has 4, and each child has 1. 4 + 1+1+1+1 = 8
      expect(stats.totalWalls).toBe(8);
      expect(stats.leafNodes).toBe(4);
      expect(stats.wallsInLeaves).toBe(4);
    });
  });
});
