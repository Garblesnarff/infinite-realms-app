import { describe, it, expect } from 'vitest';

import { pointInBounds, lineIntersectsBounds, boundsIntersect, wallIntersectsBounds } from '../geometry';

import type { AABB } from '../aabb';
import type { VisionBlocker } from '@/types/scene';

describe('spatial geometry utils', () => {
  const bounds: AABB = { minX: 10, minY: 10, maxX: 20, maxY: 20 };

  describe('pointInBounds', () => {
    it('should return true for points inside', () => {
      expect(pointInBounds({ x: 15, y: 15 }, bounds)).toBe(true);
    });

    it('should return true for points on edges', () => {
      expect(pointInBounds({ x: 10, y: 15 }, bounds)).toBe(true);
      expect(pointInBounds({ x: 20, y: 15 }, bounds)).toBe(true);
      expect(pointInBounds({ x: 15, y: 10 }, bounds)).toBe(true);
      expect(pointInBounds({ x: 15, y: 20 }, bounds)).toBe(true);
    });

    it('should return true for points on corners', () => {
      expect(pointInBounds({ x: 10, y: 10 }, bounds)).toBe(true);
      expect(pointInBounds({ x: 20, y: 20 }, bounds)).toBe(true);
    });

    it('should return false for points outside', () => {
      expect(pointInBounds({ x: 5, y: 15 }, bounds)).toBe(false);
      expect(pointInBounds({ x: 25, y: 15 }, bounds)).toBe(false);
      expect(pointInBounds({ x: 15, y: 5 }, bounds)).toBe(false);
      expect(pointInBounds({ x: 15, y: 25 }, bounds)).toBe(false);
    });
  });

  describe('lineIntersectsBounds', () => {
    it('should return true for line segment crossing the bounds', () => {
      expect(lineIntersectsBounds({ x: 5, y: 15 }, { x: 25, y: 15 }, bounds)).toBe(true);
      expect(lineIntersectsBounds({ x: 15, y: 5 }, { x: 15, y: 25 }, bounds)).toBe(true);
      expect(lineIntersectsBounds({ x: 5, y: 5 }, { x: 25, y: 25 }, bounds)).toBe(true);
    });

    it('should return true for line segment entirely inside', () => {
      expect(lineIntersectsBounds({ x: 12, y: 12 }, { x: 18, y: 18 }, bounds)).toBe(true);
    });

    it('should return true for line segment starting/ending on boundary', () => {
      expect(lineIntersectsBounds({ x: 10, y: 10 }, { x: 15, y: 15 }, bounds)).toBe(true);
      expect(lineIntersectsBounds({ x: 15, y: 15 }, { x: 20, y: 20 }, bounds)).toBe(true);
    });

    it('should return false for line segment entirely outside', () => {
      expect(lineIntersectsBounds({ x: 0, y: 0 }, { x: 5, y: 5 }, bounds)).toBe(false);
      expect(lineIntersectsBounds({ x: 25, y: 25 }, { x: 30, y: 30 }, bounds)).toBe(false);
    });

    it('should return false for parallel line segments outside', () => {
      expect(lineIntersectsBounds({ x: 5, y: 0 }, { x: 5, y: 30 }, bounds)).toBe(false);
      expect(lineIntersectsBounds({ x: 25, y: 0 }, { x: 25, y: 30 }, bounds)).toBe(false);
      expect(lineIntersectsBounds({ x: 0, y: 5 }, { x: 30, y: 5 }, bounds)).toBe(false);
      expect(lineIntersectsBounds({ x: 0, y: 25 }, { x: 30, y: 25 }, bounds)).toBe(false);
    });

    it('should handle zero-length line segments', () => {
      expect(lineIntersectsBounds({ x: 15, y: 15 }, { x: 15, y: 15 }, bounds)).toBe(true);
      expect(lineIntersectsBounds({ x: 5, y: 5 }, { x: 5, y: 5 }, bounds)).toBe(false);
    });

    it('should return true for diagonal line crossing a corner', () => {
       // Passes through (10,10)
       expect(lineIntersectsBounds({ x: 5, y: 5 }, { x: 15, y: 15 }, bounds)).toBe(true);
    });
  });

  describe('boundsIntersect', () => {
    it('should return true for overlapping bounds', () => {
      const b2: AABB = { minX: 15, minY: 15, maxX: 25, maxY: 25 };
      expect(boundsIntersect(bounds, b2)).toBe(true);
    });

    it('should return true for containing bounds', () => {
      const b2: AABB = { minX: 12, minY: 12, maxX: 18, maxY: 18 };
      expect(boundsIntersect(bounds, b2)).toBe(true);
      expect(boundsIntersect(b2, bounds)).toBe(true);
    });

    it('should return true for touching bounds', () => {
      const b2: AABB = { minX: 20, minY: 10, maxX: 30, maxY: 20 };
      expect(boundsIntersect(bounds, b2)).toBe(true);
    });

    it('should return false for separate bounds', () => {
      const b2: AABB = { minX: 21, minY: 10, maxX: 30, maxY: 20 };
      expect(boundsIntersect(bounds, b2)).toBe(false);
    });
  });

  describe('wallIntersectsBounds', () => {
    it('should return true if a point of the wall is inside', () => {
      const wall: VisionBlocker = {
        id: 'w1',
        points: [{ x: 15, y: 15 }, { x: 25, y: 25 }],
        blocksLight: true,
        blocksMovement: true
      };
      expect(wallIntersectsBounds(wall, bounds)).toBe(true);
    });

    it('should return true if an edge of the wall intersects', () => {
      const wall: VisionBlocker = {
        id: 'w1',
        points: [{ x: 5, y: 15 }, { x: 25, y: 15 }],
        blocksLight: true,
        blocksMovement: true
      };
      expect(wallIntersectsBounds(wall, bounds)).toBe(true);
    });

    it('should return true if only the closing segment of a polygon intersects', () => {
      const wall: VisionBlocker = {
        id: 'w1',
        points: [
          { x: 0, y: 0 },
          { x: 0, y: 30 },
          { x: 30, y: 30 }
        ],
        blocksLight: true,
        blocksMovement: true
      };
      // Segments: (0,0)-(0,30) no, (0,30)-(30,30) no.
      // Closing: (30,30)-(0,0) yes (crosses 10,10 to 20,20).
      expect(wallIntersectsBounds(wall, bounds)).toBe(true);
    });

    it('should return false if no intersection', () => {
      const wall: VisionBlocker = {
        id: 'w1',
        points: [{ x: 0, y: 0 }, { x: 5, y: 5 }],
        blocksLight: true,
        blocksMovement: true
      };
      expect(wallIntersectsBounds(wall, bounds)).toBe(false);
    });
  });
});
