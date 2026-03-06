import { describe, it, expect } from 'vitest';

import {
  isPointInPolygon,
  rayLineIntersection,
  simplifyPolygon,
  douglasPeucker,
  calculateRevealedArea,
  mergeFogPolygons,
  isPointRevealed,
  createCircularPolygon,
  createRectangularPolygon,
  polygonToThreeShape,
  calculatePolygonArea,
} from '../fog-calculations';

import type { Point2D, VisionBlocker } from '@/types/scene';
import type { Token } from '@/types/token';

describe('fog-calculations', () => {
  describe('isPointInPolygon', () => {
    it('should return true for a point inside a square', () => {
      const polygon: Point2D[] = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ];
      expect(isPointInPolygon({ x: 5, y: 5 }, polygon)).toBe(true);
    });

    it('should return false for a point outside a square', () => {
      const polygon: Point2D[] = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ];
      expect(isPointInPolygon({ x: 15, y: 5 }, polygon)).toBe(false);
    });

    it('should handle a triangle', () => {
      const polygon: Point2D[] = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: 10 },
      ];
      expect(isPointInPolygon({ x: 5, y: 5 }, polygon)).toBe(true);
      expect(isPointInPolygon({ x: 0, y: 5 }, polygon)).toBe(false);
    });

    it('should handle concave polygons', () => {
      const polygon: Point2D[] = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 5, y: 5 },
        { x: 0, y: 10 },
      ];
      expect(isPointInPolygon({ x: 5, y: 2 }, polygon)).toBe(true);
      expect(isPointInPolygon({ x: 5, y: 8 }, polygon)).toBe(false);
    });
  });

  describe('rayLineIntersection', () => {
    it('should return the intersection point when a ray hits a line', () => {
      const rayOrigin = { x: 0, y: 5 };
      const rayEnd = { x: 10, y: 5 };
      const segStart = { x: 5, y: 0 };
      const segEnd = { x: 5, y: 10 };

      const result = rayLineIntersection(rayOrigin, rayEnd, segStart, segEnd);
      expect(result).toEqual({ x: 5, y: 5 });
    });

    it('should return null for parallel lines', () => {
      const rayOrigin = { x: 0, y: 0 };
      const rayEnd = { x: 10, y: 0 };
      const segStart = { x: 0, y: 5 };
      const segEnd = { x: 10, y: 5 };

      expect(rayLineIntersection(rayOrigin, rayEnd, segStart, segEnd)).toBeNull();
    });

    it('should return null if the intersection is behind the ray origin', () => {
      const rayOrigin = { x: 5, y: 5 };
      const rayEnd = { x: 10, y: 5 };
      const segStart = { x: 0, y: 0 };
      const segEnd = { x: 0, y: 10 };

      expect(rayLineIntersection(rayOrigin, rayEnd, segStart, segEnd)).toBeNull();
    });
  });

  describe('simplifyPolygon', () => {
    it('should remove colinear points', () => {
      const points: Point2D[] = [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ];
      const result = simplifyPolygon(points, 0.1);
      expect(result).toHaveLength(3);
      expect(result[1]).toEqual({ x: 10, y: 0 });
    });
  });

  describe('douglasPeucker', () => {
    it('should simplify complex paths', () => {
      const points: Point2D[] = [
        { x: 0, y: 0 },
        { x: 5, y: 0.1 },
        { x: 10, y: 0 },
      ];
      const result = douglasPeucker(points, 1.0);
      expect(result).toHaveLength(2);
      expect(result).toEqual([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ]);
    });

    it('should recursively simplify if max distance > epsilon', () => {
      const points: Point2D[] = [
        { x: 0, y: 0 },
        { x: 5, y: 10 },
        { x: 10, y: 0 },
      ];
      // epsilon = 1.0, max distance is 10. Should keep the peak.
      const result = douglasPeucker(points, 1.0);
      expect(result).toHaveLength(3);
      expect(result[1]).toEqual({ x: 5, y: 10 });
    });

    it('should handle degenerate case where line is a point in perpendicular distance', () => {
      // points[0] and points[end] are the same
      const points: Point2D[] = [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
        { x: 0, y: 0 },
      ];
      const result = douglasPeucker(points, 1.0);
      expect(result).toHaveLength(3);
      expect(result[1]).toEqual({ x: 5, y: 5 });
    });
  });

  describe('calculateRevealedArea', () => {
    it('should return a basic circular vision polygon with no walls', () => {
      const token: Token = {
        id: 'token-1',
        x: 500,
        y: 500,
        vision: {
          enabled: true,
          range: 60,
          angle: 360,
        },
      } as any;
      const walls: VisionBlocker[] = [];
      const result = calculateRevealedArea(token, walls, 60, 100);

      expect(result.points.length).toBeGreaterThan(10);
      // All points should be approximately at the vision range (60ft = 1200px from 500,500)
      // Actually 60ft is 12 grid squares. If 1 square = 100px, 12 squares = 1200px.
      const dist = Math.sqrt(
        Math.pow(result.points[0].x - 500, 2) + Math.pow(result.points[0].y - 500, 2),
      );
      expect(dist).toBeCloseTo(1200, 0);
    });

    it('should respect walls', () => {
      const token: Token = {
        id: 'token-1',
        x: 500,
        y: 500,
        vision: {
          enabled: true,
          range: 60,
          angle: 360,
        },
      } as any;
      // Wall at x=1000, blocking vision to the right
      const walls: VisionBlocker[] = [
        {
          id: 'w1',
          points: [
            { x: 1000, y: 0 },
            { x: 1000, y: 2000 },
          ],
          blocksLight: true,
        },
      ] as any;

      const result = calculateRevealedArea(token, walls, 60, 100);

      // Cast a ray to the right (angle 0)
      // Origin 500, 500. Range 1200. Ray goes to 1700, 500.
      // Intersection with wall x=1000 should be at 1000, 500.
      const rightPoint = result.points.find((p) => Math.abs(p.y - 500) < 1 && p.x > 500);
      expect(rightPoint?.x).toBeCloseTo(1000, 0);
    });

    it('should handle vision cone angle < 360', () => {
      const token: Token = {
        id: 'token-1',
        x: 0,
        y: 0,
        vision: {
          enabled: true,
          range: 60,
          angle: 90,
        },
      } as any;
      const result = calculateRevealedArea(token, [], 60, 100);
      // Half angle is 45 degrees.
      // Ray at 180 degrees should be excluded.
      // We'll check if any points have negative X (which would be at > 90 or < -90 degrees)
      const pointsInBack = result.points.filter((p) => p.x < -1);
      expect(pointsInBack).toHaveLength(0);
    });

    it('should handle polygon walls (closing segment)', () => {
      const token: Token = {
        id: 'token-1',
        x: 5,
        y: 5,
        vision: {
          enabled: true,
          range: 10,
          angle: 360,
        },
      } as any;
      // Triangle wall: (10, 0), (10, 10), (15, 5)
      // Closing segment: (15, 5) to (10, 0)
      const walls: VisionBlocker[] = [
        {
          id: 'w1',
          points: [
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 15, y: 5 },
          ],
          blocksLight: true,
        },
      ] as any;
      const result = calculateRevealedArea(token, walls, 10, 100);
      // Ray at angle 0 should hit the segment (10,0)-(10,10) at (10, 5)
      const rightPoint = result.points.find((p) => Math.abs(p.y - 5) < 1 && p.x > 5);
      expect(rightPoint?.x).toBeCloseTo(10, 0);
    });

    it('should ignore walls that do not block light', () => {
      const token: Token = {
        id: 'token-1',
        x: 5,
        y: 5,
        vision: {
          enabled: true,
          range: 10,
          angle: 360,
        },
      } as any;
      const walls: VisionBlocker[] = [
        {
          id: 'w1',
          points: [
            { x: 10, y: 0 },
            { x: 10, y: 10 },
          ],
          blocksLight: false,
        },
      ] as any;
      const result = calculateRevealedArea(token, walls, 10, 100);
      const rightPoint = result.points.find((p) => Math.abs(p.y - 5) < 1 && p.x > 5);
      // Origin (5,5), range 10 feet = 200 pixels. Ray angle 0 -> (205, 5)
      expect(rightPoint?.x).toBeCloseTo(205, 0);
    });

    it('should return empty polygon if range is 0', () => {
      const token: Token = {
        id: 'token-1',
        x: 0,
        y: 0,
        vision: {
          enabled: true,
          range: 0,
          angle: 360,
        },
      } as any;
      const result = calculateRevealedArea(token, []);
      expect(result.points).toHaveLength(0);
    });

    it('should return empty polygon if vision is disabled', () => {
      const token: Token = {
        id: 'token-1',
        x: 0,
        y: 0,
        vision: {
          enabled: false,
          range: 60,
          angle: 360,
        },
      } as any;
      const result = calculateRevealedArea(token, []);
      expect(result.points).toHaveLength(0);
    });
  });

  describe('mergeFogPolygons', () => {
    it('should merge overlapping polygons', () => {
      const polygons = [
        {
          id: '1',
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 10 },
          ],
          timestamp: 0,
        },
        {
          id: '2',
          points: [
            { x: 5, y: 5 },
            { x: 15, y: 15 },
          ],
          timestamp: 0,
        },
      ];
      const result = mergeFogPolygons(polygons);
      expect(result).toHaveLength(1);
      expect(result[0].points).toHaveLength(4);
    });

    it('should not merge non-overlapping polygons', () => {
      const polygons = [
        {
          id: '1',
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 10 },
          ],
          timestamp: 0,
        },
        {
          id: '2',
          points: [
            { x: 20, y: 20 },
            { x: 30, y: 30 },
          ],
          timestamp: 0,
        },
      ];
      const result = mergeFogPolygons(polygons);
      expect(result).toHaveLength(2);
    });
  });

  describe('isPointRevealed', () => {
    it('should return true if point is in any revealed area', () => {
      const areas = [
        {
          id: '1',
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
          ],
          timestamp: 0,
        },
      ];
      expect(isPointRevealed({ x: 5, y: 5 }, areas)).toBe(true);
      expect(isPointRevealed({ x: 15, y: 15 }, areas)).toBe(false);
    });
  });

  describe('create utilities', () => {
    it('createCircularPolygon should create a polygon with requested segments', () => {
      const result = createCircularPolygon({ x: 0, y: 0 }, 10, 16);
      expect(result).toHaveLength(16);
    });

    it('createRectangularPolygon should create 4 points', () => {
      const result = createRectangularPolygon({ x: 0, y: 0 }, 10, 20);
      expect(result).toHaveLength(4);
      expect(result[2]).toEqual({ x: 10, y: 20 });
    });
  });

  describe('polygonToThreeShape', () => {
    it('should convert points to array of tuples', () => {
      const points = [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ];
      const result = polygonToThreeShape(points);
      expect(result).toEqual([
        [1, 2],
        [3, 4],
      ]);
    });
  });

  describe('calculatePolygonArea', () => {
    it('should calculate area of a square', () => {
      const points = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ];
      expect(calculatePolygonArea(points)).toBe(100);
    });

    it('should return 0 for fewer than 3 points', () => {
      expect(calculatePolygonArea([{ x: 0, y: 0 }])).toBe(0);
    });
  });
});
