import { describe, it, expect } from 'vitest';

import {
  calculateDistance,
  isPointInVisionCone,
  lineSegmentsIntersect,
  isLineBlocked,
} from '../geometry';

import type { Point2D, VisionBlocker } from '@/types/scene';

describe('geometry utils', () => {
  describe('calculateDistance', () => {
    it('should calculate distance between two points', () => {
      const p1: Point2D = { x: 0, y: 0 };
      const p2: Point2D = { x: 30, y: 40 };
      expect(calculateDistance(p1, p2)).toBe(50);
    });

    it('should handle zero distance', () => {
      const p: Point2D = { x: 10, y: 20 };
      expect(calculateDistance(p, p)).toBe(0);
    });
  });

  describe('isPointInVisionCone', () => {
    const origin: Point2D = { x: 0, y: 0 };

    it('should return true if angle is 360', () => {
      const target: Point2D = { x: 10, y: 10 };
      expect(isPointInVisionCone(origin, 0, 360, target)).toBe(true);
    });

    it('should return true if point is within cone', () => {
      const target: Point2D = { x: 10, y: 0 };
      // Facing 0 degrees, 90 degree cone (±45 deg)
      expect(isPointInVisionCone(origin, 0, 90, target)).toBe(true);
    });

    it('should return false if point is outside cone', () => {
      const target: Point2D = { x: 0, y: 10 }; // 90 degrees
      // Facing 0 degrees, 90 degree cone (±45 deg)
      expect(isPointInVisionCone(origin, 0, 90, target)).toBe(false);
    });

    it('should handle angle wrapping', () => {
      const target: Point2D = { x: -10, y: 0 }; // 180 degrees
      // Facing 170 degrees, 40 degree cone (150 to 190)
      expect(isPointInVisionCone(origin, 170, 40, target)).toBe(true);

      // Facing -170 degrees (same as 190), 40 degree cone (170 to 210)
      expect(isPointInVisionCone(origin, -170, 40, target)).toBe(true);
    });

    it('should handle large angle difference wrapping', () => {
      // Facing 10 degrees, 40 degree cone ( -10 to 30)
      // Difference is 349 - 10 = 339. 339 > 180, so 360 - 339 = 21. 21 <= 20? No, wait.
      // Let's use 10 degrees and 355 degrees. Diff 345 -> 15.
      expect(isPointInVisionCone(origin, 10, 40, { x: 10, y: -1 })).toBe(true);
    });
  });

  describe('lineSegmentsIntersect', () => {
    it('should return true for intersecting segments', () => {
      const a1 = { x: 0, y: 0 };
      const a2 = { x: 10, y: 10 };
      const b1 = { x: 0, y: 10 };
      const b2 = { x: 10, y: 0 };
      expect(lineSegmentsIntersect(a1, a2, b1, b2)).toBe(true);
    });

    it('should return false for parallel segments', () => {
      const a1 = { x: 0, y: 0 };
      const a2 = { x: 0, y: 10 };
      const b1 = { x: 5, y: 0 };
      const b2 = { x: 5, y: 10 };
      expect(lineSegmentsIntersect(a1, a2, b1, b2)).toBe(false);
    });

    it('should return false for non-intersecting non-parallel segments', () => {
      const a1 = { x: 0, y: 0 };
      const a2 = { x: 2, y: 2 };
      const b1 = { x: 5, y: 0 };
      const b2 = { x: 5, y: 10 };
      expect(lineSegmentsIntersect(a1, a2, b1, b2)).toBe(false);
    });
  });

  describe('isLineBlocked', () => {
    const from: Point2D = { x: 0, y: 0 };
    const to: Point2D = { x: 10, y: 10 };

    it('should return true if a wall blocks the line', () => {
      const walls: VisionBlocker[] = [
        {
          id: 'w1',
          points: [
            { x: 0, y: 10 },
            { x: 10, y: 0 },
          ],
          blocksLight: true,
          blocksMovement: true,
        },
      ];
      expect(isLineBlocked(from, to, walls)).toBe(true);
    });

    it('should return false if wall does not block light', () => {
      const walls: VisionBlocker[] = [
        {
          id: 'w1',
          points: [
            { x: 0, y: 10 },
            { x: 10, y: 0 },
          ],
          blocksLight: false,
          blocksMovement: true,
        },
      ];
      expect(isLineBlocked(from, to, walls)).toBe(false);
    });

    it('should return true if closing segment of a polygon blocks the line', () => {
      const from2 = { x: -5, y: 15 };
      const to2 = { x: 15, y: -5 };
      // Triangle wall: (0,0), (10,0), (10,10)
      // Segment 1: (0,0)-(10,0)
      // Segment 2: (10,0)-(10,10)
      // Closing segment: (10,10)-(0,0)
      // Line from (-5,5) to (5,5) intersects closing segment at (5,5).
      const walls: VisionBlocker[] = [
        {
          id: 'w2',
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
          ],
          blocksLight: true,
          blocksMovement: true,
        },
      ];
      expect(isLineBlocked(from2, to2, walls)).toBe(true);
    });

    it('should return false if no walls are present', () => {
      expect(isLineBlocked(from, to, [])).toBe(false);
    });
  });
});
