import { describe, it, expect } from 'vitest';

import {
  buildQuadTree,
  calculateWallBounds,
  createBoundsFromRadius,
  expandBounds,
  boundsContainsPoint,
  mergeBounds,
} from '../spatial-partitioning';

import type { VisionBlocker } from '@/types/scene';

describe('spatial-partitioning utilities', () => {
  const mockWalls: VisionBlocker[] = [
    {
      id: 'wall-1',
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      blocksLight: true,
      blocksMovement: true,
    },
    {
      id: 'wall-2',
      points: [
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      blocksLight: true,
      blocksMovement: true,
    },
    {
      id: 'wall-3',
      points: [
        { x: 50, y: 50 },
        { x: 60, y: 60 },
      ],
      blocksLight: true,
      blocksMovement: true,
    },
  ];

  describe('calculateWallBounds', () => {
    it('should return default bounds for empty walls', () => {
      const padding = 100;
      const bounds = calculateWallBounds([], padding);
      expect(bounds).toEqual({
        minX: -padding,
        minY: -padding,
        maxX: padding,
        maxY: padding,
      });
    });

    it('should calculate bounds for a set of walls', () => {
      const bounds = calculateWallBounds(mockWalls, 0);
      expect(bounds).toEqual({
        minX: 0,
        minY: 0,
        maxX: 100,
        maxY: 100,
      });
    });

    it('should include padding in the calculation', () => {
      const bounds = calculateWallBounds(mockWalls, 10);
      expect(bounds).toEqual({
        minX: -10,
        minY: -10,
        maxX: 110,
        maxY: 110,
      });
    });
  });

  describe('QuadTree', () => {
    it('should build a quadtree correctly', () => {
      const quadTree = buildQuadTree(mockWalls);
      const stats = quadTree.getStats();
      expect(stats.totalWalls).toBeGreaterThan(0);
      expect(stats.totalNodes).toBeGreaterThan(0);
    });

    it('should find walls within query bounds', () => {
      const quadTree = buildQuadTree(mockWalls);
      const results = quadTree.query({ minX: 45, minY: 45, maxX: 65, maxY: 65 });

      // wall-3 is definitely in here
      expect(results.some(w => w.id === 'wall-3')).toBe(true);
      // walls 1 and 2 should not be in this small central box if it was split well,
      // but they might be depending on node bounds.
      // More importantly, wall-3 MUST be there.
    });

    it('should find walls by radius', () => {
      const quadTree = buildQuadTree(mockWalls);
      const results = quadTree.queryRadius({ x: 55, y: 55 }, 10);
      expect(results.some(w => w.id === 'wall-3')).toBe(true);
    });

    it('should find walls along a line', () => {
      const quadTree = buildQuadTree(mockWalls);
      // Line from (40,40) to (70,70) passes through wall-3 (50,50 to 60,60)
      const results = quadTree.queryLine({ x: 40, y: 40 }, { x: 70, y: 70 });
      expect(results.some(w => w.id === 'wall-3')).toBe(true);
    });

    it('should return empty array for out of bounds query', () => {
      const quadTree = buildQuadTree(mockWalls);
      const results = quadTree.query({ minX: 200, minY: 200, maxX: 300, maxY: 300 });
      expect(results.length).toBe(0);
    });

    it('should respect maxWalls and split nodes', () => {
      // Create many small walls in one corner
      const manyWalls: VisionBlocker[] = Array.from({ length: 20 }).map((_, i) => ({
        id: `wall-${i}`,
        points: [{ x: i, y: i }, { x: i + 1, y: i + 1 }],
        blocksLight: true,
        blocksMovement: true,
      }));

      const quadTree = buildQuadTree(manyWalls, 0, { maxWalls: 5 });
      const stats = quadTree.getStats();

      expect(stats.totalNodes).toBeGreaterThan(1); // Should have split
      expect(stats.maxDepth).toBeGreaterThan(0);
    });

    it('should respect maxLevel depth limit', () => {
      const manyWalls: VisionBlocker[] = Array.from({ length: 20 }).map((_, i) => ({
        id: `wall-${i}`,
        points: [{ x: 1, y: 1 }, { x: 2, y: 2 }],
        blocksLight: true,
        blocksMovement: true,
      }));

      const quadTree = buildQuadTree(manyWalls, 0, { maxWalls: 2, maxLevel: 2 });
      const stats = quadTree.getStats();

      expect(stats.maxDepth).toBeLessThanOrEqual(2);
    });

    it('should rebuild the tree correctly', () => {
      const quadTree = buildQuadTree(mockWalls);
      const initialResults = quadTree.queryRadius({ x: 55, y: 55 }, 10);
      expect(initialResults.some(w => w.id === 'wall-3')).toBe(true);

      const newWalls: VisionBlocker[] = [
        {
          id: 'new-wall',
          points: [{ x: 500, y: 500 }, { x: 600, y: 600 }],
          blocksLight: true,
          blocksMovement: true,
        }
      ];

      quadTree.rebuild(newWalls);
      const resultsAfterRebuild = quadTree.queryRadius({ x: 55, y: 55 }, 10);
      expect(resultsAfterRebuild.length).toBe(0);

      const resultsNearNewWall = quadTree.queryRadius({ x: 550, y: 550 }, 100);
      expect(resultsNearNewWall.some(w => w.id === 'new-wall')).toBe(true);
    });

    it('should handle polygon walls (closed loops)', () => {
        const polygonWall: VisionBlocker = {
            id: 'poly-1',
            points: [
                { x: 10, y: 10 },
                { x: 20, y: 10 },
                { x: 15, y: 20 }
            ],
            blocksLight: true,
            blocksMovement: true
        };

        const quadTree = buildQuadTree([polygonWall], 0);

        // Query intersecting the closing edge (15,20 to 10,10)
        const results = quadTree.query({ minX: 11, minY: 14, maxX: 13, maxY: 16 });
        expect(results.some(w => w.id === 'poly-1')).toBe(true);
    });
  });

  describe('helper functions', () => {
    it('createBoundsFromRadius should create correct bounds', () => {
      const bounds = createBoundsFromRadius({ x: 100, y: 100 }, 50);
      expect(bounds).toEqual({
        minX: 50,
        minY: 50,
        maxX: 150,
        maxY: 150,
      });
    });

    it('expandBounds should expand correctly', () => {
      const initial = { minX: 10, minY: 10, maxX: 20, maxY: 20 };
      const expanded = expandBounds(initial, 5);
      expect(expanded).toEqual({
        minX: 5,
        minY: 5,
        maxX: 25,
        maxY: 25,
      });
    });

    it('boundsContainsPoint should work', () => {
      const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
      expect(boundsContainsPoint(bounds, { x: 50, y: 50 })).toBe(true);
      expect(boundsContainsPoint(bounds, { x: 150, y: 50 })).toBe(false);
      expect(boundsContainsPoint(bounds, { x: 0, y: 0 })).toBe(true);
      expect(boundsContainsPoint(bounds, { x: 100, y: 100 })).toBe(true);
    });

    it('mergeBounds should merge correctly', () => {
      const b1 = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
      const b2 = { minX: 5, minY: 5, maxX: 20, maxY: 20 };
      const merged = mergeBounds([b1, b2]);
      expect(merged).toEqual({
        minX: 0,
        minY: 0,
        maxX: 20,
        maxY: 20,
      });
    });

    it('mergeBounds should return zero bounds for empty list', () => {
        expect(mergeBounds([])).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
    });
  });
});
