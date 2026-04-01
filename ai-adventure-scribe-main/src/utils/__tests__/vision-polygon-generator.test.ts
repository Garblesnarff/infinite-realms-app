/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { raycastToWalls } from '../raycasting';
import {
  getAllRayIntersections,
  sortPointsByAngle,
  sortEndpointsByAngle,
  removeDuplicatePoints,
} from '../vision-polygon-generator';

import type { VisionBlocker } from '@/types/scene';

// Mock raycastToWalls
vi.mock('../raycasting', () => ({
  raycastToWalls: vi.fn(),
}));

describe('vision-polygon-generator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('sortPointsByAngle', () => {
    it('should sort points clockwise from east (-PI to PI)', () => {
      const origin = { x: 0, y: 0 };
      const points = [
        { x: 0, y: 10 },   // South (PI/2)
        { x: 10, y: 0 },   // East (0)
        { x: 0, y: -10 },  // North (-PI/2)
        { x: -10, y: 0 },  // West (PI or -PI)
      ];

      const sorted = sortPointsByAngle(origin, points);

      // atan2 returns values in range (-PI, PI]
      // East: 0
      // South: PI/2
      // West: PI
      // North: -PI/2
      // Sorted order by angle: North (-1.57), East (0), South (1.57), West (3.14)
      expect(sorted[0]).toEqual({ x: 0, y: -10 });
      expect(sorted[1]).toEqual({ x: 10, y: 0 });
      expect(sorted[2]).toEqual({ x: 0, y: 10 });
      expect(sorted[3]).toEqual({ x: -10, y: 0 });
    });
  });

  describe('sortEndpointsByAngle', () => {
    it('should sort endpoints by their angle property', () => {
      const endpoints: any[] = [
        { angle: 1.5 },
        { angle: -0.5 },
        { angle: 0 },
        { angle: -1.5 },
      ];

      const sorted = sortEndpointsByAngle(endpoints);

      expect(sorted[0].angle).toBe(-1.5);
      expect(sorted[1].angle).toBe(-0.5);
      expect(sorted[2].angle).toBe(0);
      expect(sorted[3].angle).toBe(1.5);
    });
  });

  describe('removeDuplicatePoints', () => {
    it('should remove points that are too close to each other', () => {
      const points = [
        { x: 10, y: 10 },
        { x: 10.05, y: 10.05 }, // Duplicate within default 0.1 tolerance
        { x: 20, y: 20 },
      ];

      const deduplicated = removeDuplicatePoints(points);

      expect(deduplicated).toHaveLength(2);
      expect(deduplicated[0]).toEqual({ x: 10, y: 10 });
      expect(deduplicated[1]).toEqual({ x: 20, y: 20 });
    });

    it('should respect custom tolerance', () => {
      const points = [
        { x: 10, y: 10 },
        { x: 10.2, y: 10.2 }, // Distance is ~0.28, greater than 0.1
      ];

      expect(removeDuplicatePoints(points, 0.1)).toHaveLength(2);
      expect(removeDuplicatePoints(points, 0.5)).toHaveLength(1);
    });

    it('should return empty array for empty input', () => {
      expect(removeDuplicatePoints([])).toEqual([]);
    });
  });

  describe('getAllRayIntersections', () => {
    const origin = { x: 100, y: 100 };
    const maxRange = 500;

    it('should return a circle of points if no walls are provided', () => {
      const result = getAllRayIntersections(origin, [], maxRange);

      expect(result).toHaveLength(32);
      // Verify first point is roughly at -PI angle
      expect(result[0].angle).toBeCloseTo(-Math.PI);
      // Verify points are at maxRange
      const dist = Math.sqrt(
        Math.pow(result[0].point.x - origin.x, 2) +
        Math.pow(result[0].point.y - origin.y, 2)
      );
      expect(dist).toBeCloseTo(maxRange);
    });

    it('should collect wall vertices and cast rays', () => {
      const walls: VisionBlocker[] = [
        {
          id: 'wall-1',
          points: [{ x: 200, y: 200 }, { x: 200, y: 100 }],
          blocksLight: true,
        } as any,
      ];

      vi.mocked(raycastToWalls).mockImplementation((orig, dir, _w, _range) => {
        return {
          point: { x: orig.x + dir.x * 100, y: orig.y + dir.y * 100 },
          distance: 100,
          wallId: 'wall-1',
        };
      });

      const result = getAllRayIntersections(origin, walls, maxRange);

      // 2 vertices * 3 rays each = 6 endpoints
      expect(result).toHaveLength(6);
      expect(raycastToWalls).toHaveBeenCalled();
      expect(result[0].isWallVertex).toBe(true);
      expect(result[0].wallId).toBe('wall-1');
    });

    it('should skip walls that do not block light', () => {
      const walls: VisionBlocker[] = [
        {
          id: 'wall-1',
          points: [{ x: 200, y: 200 }],
          blocksLight: false,
        } as any,
      ];

      const result = getAllRayIntersections(origin, walls, maxRange);

      // Should fallback to circle because no light-blocking walls
      expect(result).toHaveLength(32);
    });

    it('should handle raycast misses by extending to maxRange', () => {
      const walls: VisionBlocker[] = [
        {
          id: 'wall-1',
          points: [{ x: 200, y: 200 }],
          blocksLight: true,
        } as any,
      ];

      // Mock miss
      vi.mocked(raycastToWalls).mockReturnValue(null);

      const result = getAllRayIntersections(origin, walls, maxRange);

      expect(result).toHaveLength(3); // 1 vertex * 3 rays
      expect(result[0].distance).toBe(maxRange);
      expect(result[0].isWallVertex).toBe(false);

      const dist = Math.sqrt(
        Math.pow(result[0].point.x - origin.x, 2) +
        Math.pow(result[0].point.y - origin.y, 2)
      );
      expect(dist).toBeCloseTo(maxRange);
    });

    it('should avoid duplicate angles', () => {
        const walls: VisionBlocker[] = [
          {
            id: 'wall-1',
            points: [{ x: 200, y: 200 }],
            blocksLight: true,
          } as any,
          {
            id: 'wall-2',
            points: [{ x: 200, y: 200 }], // Same point
            blocksLight: true,
          } as any,
        ];

        vi.mocked(raycastToWalls).mockReturnValue({
          point: { x: 200, y: 200 },
          distance: 141.4,
          wallId: 'wall-1',
        });

        const result = getAllRayIntersections(origin, walls, maxRange);

        // Should still be 3 rays because angles are identical
        expect(result).toHaveLength(3);
      });
  });
});
