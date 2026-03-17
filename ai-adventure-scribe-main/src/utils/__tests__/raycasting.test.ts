/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';

import {
  raycastToWalls,
  getAllRayIntersections,
  lineSegmentIntersection,
  sortPointsByAngle,
  sortEndpointsByAngle,
  removeDuplicatePoints,
  raycastCone,
  isInShadow,
  calculateReflection,
} from '../raycasting';

import type { VisionBlocker } from '@/types/scene';

describe('raycasting utils', () => {
  const mockWalls: VisionBlocker[] = [
    {
      id: 'wall-1',
      points: [
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      blocksLight: true,
    },
    {
      id: 'wall-2',
      points: [
        { x: 0, y: 100 },
        { x: 100, y: 100 },
      ],
      blocksLight: true,
    },
    {
      id: 'no-block',
      points: [
        { x: 50, y: 0 },
        { x: 50, y: 50 },
      ],
      blocksLight: false,
    },
  ];

  describe('raycastToWalls', () => {
    it('should find intersection with a single wall', () => {
      const origin = { x: 0, y: 50 };
      const direction = { x: 1, y: 0 };
      const result = raycastToWalls(origin, direction, mockWalls);

      expect(result).not.toBeNull();
      expect(result?.point).toEqual({ x: 100, y: 50 });
      expect(result?.wallId).toBe('wall-1');
      expect(result?.distance).toBe(100);
    });

    it('should find the closest intersection when multiple walls are hit', () => {
      const origin = { x: 50, y: 50 };
      const direction = { x: 1, y: 1 }; // Towards (100, 100)
      const result = raycastToWalls(origin, direction, mockWalls);

      expect(result).not.toBeNull();
      expect(result?.point.x).toBeCloseTo(100);
      expect(result?.point.y).toBeCloseTo(100);
      expect(result?.distance).toBeCloseTo(Math.sqrt(50 * 50 + 50 * 50));
    });

    it('should ignore walls that do not block light', () => {
      const origin = { x: 0, y: 25 };
      const direction = { x: 1, y: 0 };
      const result = raycastToWalls(origin, direction, mockWalls);

      // Should hit wall-1 at (100, 25), not no-block at (50, 25)
      expect(result?.point.x).toBe(100);
      expect(result?.wallId).toBe('wall-1');
    });

    it('should return null if no walls are hit', () => {
      const origin = { x: 0, y: 50 };
      const direction = { x: -1, y: 0 };
      const result = raycastToWalls(origin, direction, mockWalls);

      expect(result).toBeNull();
    });

    it('should handle polygon walls (closing segment)', () => {
      const polyWall: VisionBlocker = {
        id: 'poly',
        points: [
          { x: 200, y: 200 },
          { x: 300, y: 200 },
          { x: 250, y: 300 },
        ],
        blocksLight: true,
      };

      // Ray hitting the closing segment (250, 300) to (200, 200)
      const origin = { x: 100, y: 250 };
      const direction = { x: 1, y: 0 };
      const result = raycastToWalls(origin, direction, [polyWall]);

      expect(result).not.toBeNull();
      expect(result?.wallId).toBe('poly');
      expect(result?.segmentIndex).toBe(2); // Closing segment
    });

    it('should return null for zero-length direction', () => {
      const result = raycastToWalls({ x: 0, y: 0 }, { x: 0, y: 0 }, mockWalls);
      expect(result).toBeNull();
    });
  });

  describe('getAllRayIntersections', () => {
    it('should cast rays to all vertices and handle edge cases', () => {
      const origin = { x: 50, y: 50 };
      const walls: VisionBlocker[] = [{
        id: 'w1',
        points: [{ x: 100, y: 0 }, { x: 100, y: 100 }],
        blocksLight: true
      }];
      const result = getAllRayIntersections(origin, walls, 500);

      expect(result.length).toBeGreaterThanOrEqual(6);
      expect(result.some(e => e.wallId === 'w1')).toBe(true);
    });

    it('should return a circle of points if no walls exist', () => {
      const origin = { x: 0, y: 0 };
      const result = getAllRayIntersections(origin, [], 100);

      expect(result.length).toBe(32);
      result.forEach(e => {
        expect(e.distance).toBe(100);
        expect(Math.sqrt(e.point.x ** 2 + e.point.y ** 2)).toBeCloseTo(100);
      });
    });
  });

  describe('lineSegmentIntersection', () => {
    it('should return intersection point for intersecting segments', () => {
      const l1 = { start: { x: 0, y: 0 }, end: { x: 10, y: 10 } };
      const l2 = { start: { x: 0, y: 10 }, end: { x: 10, y: 0 } };
      const result = lineSegmentIntersection(l1, l2);

      expect(result).toEqual({ x: 5, y: 5 });
    });

    it('should return null for parallel segments', () => {
      const l1 = { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } };
      const l2 = { start: { x: 0, y: 1 }, end: { x: 10, y: 1 } };
      const result = lineSegmentIntersection(l1, l2);

      expect(result).toBeNull();
    });

    it('should return null if segments do not intersect', () => {
      const l1 = { start: { x: 0, y: 0 }, end: { x: 5, y: 5 } };
      const l2 = { start: { x: 10, y: 0 }, end: { x: 15, y: 5 } };
      const result = lineSegmentIntersection(l1, l2);

      expect(result).toBeNull();
    });
  });

  describe('sortPointsByAngle', () => {
    it('should sort points clockwise around origin', () => {
      const origin = { x: 0, y: 0 };
      const points = [
        { x: 0, y: 1 },   // PI/2
        { x: 1, y: 0 },   // 0
        { x: 0, y: -1 },  // -PI/2
        { x: -1, y: 0 },  // PI
      ];
      const sorted = sortPointsByAngle(origin, points);

      expect(sorted[0]).toEqual({ x: 0, y: -1 }); // -PI/2
      expect(sorted[1]).toEqual({ x: 1, y: 0 });  // 0
      expect(sorted[2]).toEqual({ x: 0, y: 1 });  // PI/2
      expect(sorted[3]).toEqual({ x: -1, y: 0 }); // PI
    });
  });

  describe('sortEndpointsByAngle', () => {
    it('should sort endpoints by angle', () => {
      const endpoints: any[] = [
        { angle: 1.5 },
        { angle: -1.0 },
        { angle: 0.5 },
      ];
      const sorted = sortEndpointsByAngle(endpoints);
      expect(sorted[0].angle).toBe(-1.0);
      expect(sorted[1].angle).toBe(0.5);
      expect(sorted[2].angle).toBe(1.5);
    });
  });

  describe('removeDuplicatePoints', () => {
    it('should remove points within tolerance', () => {
      const points = [
        { x: 10, y: 10 },
        { x: 10.05, y: 10.05 },
        { x: 20, y: 20 },
      ];
      const result = removeDuplicatePoints(points, 0.1);
      expect(result.length).toBe(2);
      expect(result[0]).toEqual({ x: 10, y: 10 });
      expect(result[1]).toEqual({ x: 20, y: 20 });
    });

    it('should handle empty array', () => {
      expect(removeDuplicatePoints([])).toEqual([]);
    });
  });

  describe('raycastCone', () => {
    it('should cast multiple rays in a cone', () => {
      const origin = { x: 0, y: 0 };
      const wall: VisionBlocker = {
        id: 'w',
        points: [{ x: 10, y: -10 }, { x: 10, y: 10 }],
        blocksLight: true
      };
      const result = raycastCone(origin, 0, Math.PI / 2, 5, [wall]);

      expect(result.length).toBe(5);
      result.forEach(hit => {
        expect(hit.point.x).toBeCloseTo(10);
        expect(hit.wallId).toBe('w');
      });
    });
  });

  describe('isInShadow', () => {
    const wall: VisionBlocker = {
      id: 'w',
      points: [{ x: 50, y: 0 }, { x: 50, y: 100 }],
      blocksLight: true
    };

    it('should return true if point is in shadow', () => {
      const lightSource = { x: 0, y: 50 };
      const point = { x: 100, y: 50 };
      expect(isInShadow(point, lightSource, wall)).toBe(true);
    });

    it('should return false if point is not in shadow', () => {
      const lightSource = { x: 0, y: 50 };
      const point = { x: 25, y: 50 };
      expect(isInShadow(point, lightSource, wall)).toBe(false);
    });

    it('should return false if wall does not block light', () => {
      const transparentWall = { ...wall, blocksLight: false };
      const lightSource = { x: 0, y: 50 };
      const point = { x: 100, y: 50 };
      expect(isInShadow(point, lightSource, transparentWall)).toBe(false);
    });

    it('should handle zero distance', () => {
      const lightSource = { x: 0, y: 0 };
      const point = { x: 0, y: 0 };
      expect(isInShadow(point, lightSource, wall)).toBe(false);
    });
  });

  describe('calculateReflection', () => {
    it('should calculate reflection vector correctly', () => {
      const incident = { x: 1, y: 1 };
      const normal = { x: -1, y: 0 };
      const result = calculateReflection(incident, normal);
      expect(result).toEqual({ x: -1, y: 1 });
    });
  });
});
