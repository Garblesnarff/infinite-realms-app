import { describe, it, expect } from 'vitest';
import type { Point2D } from '@/types/scene';
import smoothPath, {
  distance,
  reducePoints,
  fitQuadraticBezier,
  pointsToSVGPath,
  pointsToSmoothSVGPath,
  douglasPeucker,
} from '../drawing-smoothing';

describe('drawing-smoothing utils', () => {
  const p1: Point2D = { x: 0, y: 0 };
  const p2: Point2D = { x: 3, y: 4 };
  const p3: Point2D = { x: 6, y: 0 };
  const p4: Point2D = { x: 9, y: 4 };

  describe('distance', () => {
    it('calculates the Euclidean distance between two points', () => {
      expect(distance(p1, p2)).toBe(5);
      expect(distance(p1, p1)).toBe(0);
    });
  });

  describe('reducePoints', () => {
    it('returns the same points if length < 2', () => {
      const singlePoint = [{ x: 1, y: 1 }];
      expect(reducePoints(singlePoint)).toEqual(singlePoint);
      expect(reducePoints([])).toEqual([]);
    });

    it('filters out points that are too close together', () => {
      const points = [
        { x: 0, y: 0 },
        { x: 0.5, y: 0.5 }, // Too close to (0,0) with default minDistance=2
        { x: 3, y: 3 },
        { x: 3.1, y: 3.1 }, // Too close to (3,3)
        { x: 6, y: 6 },
      ];
      const reduced = reducePoints(points);
      expect(reduced).toEqual([
        { x: 0, y: 0 },
        { x: 3, y: 3 },
        { x: 6, y: 6 },
      ]);
    });

    it('always keeps the first and last points', () => {
      const points = [
        { x: 0, y: 0 },
        { x: 0.1, y: 0.1 },
        { x: 0.2, y: 0.2 },
      ];
      const reduced = reducePoints(points, 2);
      expect(reduced).toEqual([
        { x: 0, y: 0 },
        { x: 0.2, y: 0.2 },
      ]);
    });
  });

  describe('smoothPath (Catmull-Rom)', () => {
    it('handles edge cases with few points', () => {
      expect(smoothPath([])).toEqual([]);
      const onePoint = [{ x: 1, y: 1 }];
      expect(smoothPath(onePoint)).toEqual(onePoint);
      const twoPoints = [{ x: 0, y: 0 }, { x: 10, y: 10 }];
      expect(smoothPath(twoPoints)).toEqual(twoPoints);
    });

    it('interpolates points for a path with 3 or more points', () => {
      const points = [p1, p2, p3];
      const smoothed = smoothPath(points);
      // segmentsPerPoint is 8, so for 2 segments we expect 1 (initial) + 8 + 8 = 17 points
      expect(smoothed.length).toBe(17);
      expect(smoothed[0]).toEqual(p1);
      expect(smoothed[smoothed.length - 1]).toEqual(p3);
    });

    it('respects reducePoints: false option', () => {
      const points = [
        { x: 0, y: 0 },
        { x: 0.1, y: 0.1 },
        { x: 10, y: 10 },
      ];
      // With reducePoints: true (default), middle point would be removed
      const smoothedDefault = smoothPath(points);
      // inputPoints would be [p0, p2] which has length 2, returns as-is
      expect(smoothedDefault.length).toBe(2);

      const smoothedNoReduce = smoothPath(points, { reducePoints: false });
      expect(smoothedNoReduce.length).toBe(17);
    });

    it('respects maxPoints option', () => {
      const points = [p1, p2, p3, p4];
      const maxPoints = 5;
      const smoothed = smoothPath(points, { maxPoints });
      // The implementation adds one more if maxPoints is reached via "Always include last point"
      // Wait, let's check implementation:
      // for (let i = 0; i < maxPoints; i++) { ... limited.push(smoothed[index]); }
      // limited.push(smoothed[smoothed.length - 1]);
      // So it returns maxPoints + 1 points.
      expect(smoothed.length).toBe(maxPoints + 1);
      expect(smoothed[0]).toEqual(p1);
      expect(smoothed[smoothed.length - 1]).toEqual(p4);
    });

    it('uses the default export as smoothPath', () => {
      expect(smoothPath).toBeDefined();
      const points = [p1, p2, p3];
      expect(smoothPath(points)).toEqual(smoothPath(points));
    });
  });

  describe('fitQuadraticBezier', () => {
    it('returns same points if length < 3', () => {
      const twoPoints = [p1, p2];
      expect(fitQuadraticBezier(twoPoints)).toEqual(twoPoints);
    });

    it('fits curves through points', () => {
      const points = [p1, p2, p3];
      const steps = 5;
      const fitted = fitQuadraticBezier(points, steps);
      // 1 (initial) + 5 = 6 points for one segment (i=0, i+2=2)
      expect(fitted.length).toBe(6);
      expect(fitted[0]).toEqual(p1);
      expect(fitted[fitted.length - 1]).toEqual(p3);
    });

    it('handles multiple segments', () => {
       const points = [p1, p2, p3, p4, { x: 12, y: 0 }];
       const steps = 5;
       const fitted = fitQuadraticBezier(points, steps);
       // loop i=0 (p0,p1,p2), i=2 (p2,p3,p4). Total 2 segments.
       // 1 (initial) + 5 + 5 = 11 points
       expect(fitted.length).toBe(11);
    });
  });

  describe('douglasPeucker simplification', () => {
    it('returns same points if length < 3', () => {
      const twoPoints = [p1, p2];
      expect(douglasPeucker(twoPoints)).toEqual(twoPoints);
    });

    it('simplifies a straight line with intermediate points', () => {
      const line = [
        { x: 0, y: 0 },
        { x: 1, y: 0.01 }, // negligible deviation
        { x: 2, y: 0 },
        { x: 5, y: 0 },
      ];
      const simplified = douglasPeucker(line, 0.1);
      expect(simplified).toEqual([
        { x: 0, y: 0 },
        { x: 5, y: 0 },
      ]);
    });

    it('preserves points exceeding the epsilon threshold', () => {
      const path = [
        { x: 0, y: 0 },
        { x: 5, y: 10 }, // large deviation
        { x: 10, y: 0 },
      ];
      const simplified = douglasPeucker(path, 1);
      expect(simplified).toEqual(path);
    });

    it('handles zero length segments', () => {
        const points = [{x: 0, y: 0}, {x: 0, y: 0}, {x: 0, y: 0}];
        expect(douglasPeucker(points, 1)).toEqual([{x:0, y:0}, {x:0, y:0}]);
    });

    it('handles zero length segments where maxDistance > epsilon', () => {
        // Points: (0,0), (10,10), (0,0). Line from (0,0) to (0,0).
        // Distance from (10,10) to (0,0) is sqrt(200) approx 14.14.
        const points = [{x: 0, y: 0}, {x: 10, y: 10}, {x: 0, y: 0}];
        const simplified = douglasPeucker(points, 1);
        // maxDistance is 14.14, which is > 1.
        // It will recurse: left = DP([(0,0), (10,10)], 1), right = DP([(10,10), (0,0)], 1)
        // Both left and right have length 2, so they return as-is.
        // Result: [(0,0), (10,10)] (slice 0, -1) + [(10,10), (0,0)] = [(0,0), (10,10), (0,0)]
        expect(simplified).toEqual(points);
    });
  });

  describe('SVG path generation', () => {
    it('pointsToSVGPath handles few points', () => {
      expect(pointsToSVGPath([])).toBe('');
      expect(pointsToSVGPath([p1])).toBe('');
      expect(pointsToSVGPath([p1, p2])).toBe('M 0 0 L 3 4');
    });

    it('pointsToSVGPath generates a smooth path string', () => {
      const points = [p1, p2, p3];
      const path = pointsToSVGPath(points);
      expect(path).toContain('M 0 0');
      expect(path).toContain('L');
      // Should have multiple L commands due to smoothing
      const lCount = (path.match(/L/g) || []).length;
      expect(lCount).toBeGreaterThan(1);
    });

    it('pointsToSmoothSVGPath handles few points', () => {
      expect(pointsToSmoothSVGPath([])).toBe('');
      expect(pointsToSmoothSVGPath([p1, p2])).toBe('M 0 0 L 3 4');
    });

    it('pointsToSmoothSVGPath uses quadratic Bezier commands (Q)', () => {
      const points = [p1, p2, p3, p4];
      const path = pointsToSmoothSVGPath(points);
      expect(path).toContain('M 0 0');
      expect(path).toContain('Q');
      expect(path).toContain('L'); // Final point
    });
  });
});
