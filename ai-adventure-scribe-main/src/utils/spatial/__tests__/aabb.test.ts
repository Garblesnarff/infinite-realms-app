import { describe, it, expect } from 'vitest';

import {
  calculateWallBounds,
  createBoundsFromRadius,
  expandBounds,
  boundsContainsPoint,
  mergeBounds,
  type AABB,
} from '../aabb';

import type { VisionBlocker } from '@/types/scene';

describe('aabb utilities', () => {
  describe('calculateWallBounds', () => {
    it('should return symmetric bounds around origin for empty walls with padding', () => {
      const padding = 50;
      const bounds = calculateWallBounds([], padding);
      expect(bounds).toEqual({
        minX: -50,
        minY: -50,
        maxX: 50,
        maxY: 50,
      });
    });

    it('should calculate bounds for a single wall', () => {
      const walls: VisionBlocker[] = [
        {
          id: 'w1',
          points: [
            { x: 10, y: 10 },
            { x: 100, y: 50 },
          ],
          blocksLight: true,
          blocksMovement: true,
        },
      ];
      const bounds = calculateWallBounds(walls);
      expect(bounds).toEqual({
        minX: 10,
        minY: 10,
        maxX: 100,
        maxY: 50,
      });
    });

    it('should apply padding to calculated bounds', () => {
      const walls: VisionBlocker[] = [
        {
          id: 'w1',
          points: [
            { x: 10, y: 10 },
            { x: 100, y: 50 },
          ],
          blocksLight: true,
          blocksMovement: true,
        },
      ];
      const padding = 10;
      const bounds = calculateWallBounds(walls, padding);
      expect(bounds).toEqual({
        minX: 0,
        minY: 0,
        maxX: 110,
        maxY: 60,
      });
    });

    it('should calculate bounds for multiple walls with multiple points', () => {
      const walls: VisionBlocker[] = [
        {
          id: 'w1',
          points: [
            { x: 10, y: 10 },
            { x: 100, y: 50 },
          ],
          blocksLight: true,
          blocksMovement: true,
        },
        {
          id: 'w2',
          points: [
            { x: -50, y: 200 },
            { x: 20, y: -30 },
            { x: 300, y: 150 },
          ],
          blocksLight: true,
          blocksMovement: true,
        },
      ];
      const bounds = calculateWallBounds(walls);
      expect(bounds).toEqual({
        minX: -50,
        minY: -30,
        maxX: 300,
        maxY: 200,
      });
    });

    it('should handle negative coordinates and zero correctly', () => {
      const walls: VisionBlocker[] = [
        {
          id: 'w1',
          points: [
            { x: -100, y: -100 },
            { x: 0, y: 0 },
          ],
          blocksLight: true,
          blocksMovement: true,
        },
      ];
      const bounds = calculateWallBounds(walls);
      expect(bounds).toEqual({
        minX: -100,
        minY: -100,
        maxX: 0,
        maxY: 0,
      });
    });
  });

  describe('createBoundsFromRadius', () => {
    it('should create bounds centered at point with given radius', () => {
      const center = { x: 100, y: 100 };
      const radius = 50;
      const bounds = createBoundsFromRadius(center, radius);
      expect(bounds).toEqual({
        minX: 50,
        minY: 50,
        maxX: 150,
        maxY: 150,
      });
    });

    it('should handle zero radius', () => {
      const center = { x: 10, y: 20 };
      const bounds = createBoundsFromRadius(center, 0);
      expect(bounds).toEqual({
        minX: 10,
        minY: 20,
        maxX: 10,
        maxY: 20,
      });
    });
  });

  describe('expandBounds', () => {
    it('should expand all sides by given amount', () => {
      const initial: AABB = { minX: 10, minY: 10, maxX: 100, maxY: 100 };
      const expanded = expandBounds(initial, 10);
      expect(expanded).toEqual({
        minX: 0,
        minY: 0,
        maxX: 110,
        maxY: 110,
      });
    });

    it('should handle negative expansion (contraction)', () => {
      const initial: AABB = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
      const contracted = expandBounds(initial, -10);
      expect(contracted).toEqual({
        minX: 10,
        minY: 10,
        maxX: 90,
        maxY: 90,
      });
    });
  });

  describe('boundsContainsPoint', () => {
    const bounds: AABB = { minX: 10, minY: 10, maxX: 100, maxY: 100 };

    it('should return true for point inside bounds', () => {
      expect(boundsContainsPoint(bounds, { x: 50, y: 50 })).toBe(true);
    });

    it('should return true for points on the edge', () => {
      expect(boundsContainsPoint(bounds, { x: 10, y: 10 })).toBe(true);
      expect(boundsContainsPoint(bounds, { x: 100, y: 100 })).toBe(true);
      expect(boundsContainsPoint(bounds, { x: 10, y: 50 })).toBe(true);
      expect(boundsContainsPoint(bounds, { x: 50, y: 100 })).toBe(true);
    });

    it('should return false for point outside bounds', () => {
      expect(boundsContainsPoint(bounds, { x: 0, y: 50 })).toBe(false);
      expect(boundsContainsPoint(bounds, { x: 110, y: 50 })).toBe(false);
      expect(boundsContainsPoint(bounds, { x: 50, y: 0 })).toBe(false);
      expect(boundsContainsPoint(bounds, { x: 50, y: 110 })).toBe(false);
    });
  });

  describe('mergeBounds', () => {
    it('should return zeroed bounds for empty list', () => {
      expect(mergeBounds([])).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
    });

    it('should correctly merge multiple bounds', () => {
      const b1: AABB = { minX: 10, minY: 10, maxX: 50, maxY: 50 };
      const b2: AABB = { minX: -10, minY: 20, maxX: 30, maxY: 80 };
      const b3: AABB = { minX: 5, minY: -5, maxX: 100, maxY: 15 };

      const merged = mergeBounds([b1, b2, b3]);
      expect(merged).toEqual({
        minX: -10,
        minY: -5,
        maxX: 100,
        maxY: 80,
      });
    });

    it('should return identical bounds if list contains one element', () => {
      const b1: AABB = { minX: 10, minY: 20, maxX: 30, maxY: 40 };
      expect(mergeBounds([b1])).toEqual(b1);
    });
  });
});
