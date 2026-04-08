import { describe, it, expect } from 'vitest';

import {
  getPolygonBoundingBox,
  polygonBoundingBoxesOverlap,
  isPointInPolygon,
  simplifyPolygon,
  perpendicularDistance,
  douglasPeucker,
  calculatePolygonArea,
  createCircularPolygon,
  createRectangularPolygon,
  polygonToThreeShape,
} from '../polygon-utils';

describe('polygon-utils', () => {
  describe('getPolygonBoundingBox', () => {
    it('should calculate bounding box for a triangle', () => {
      const points = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: 10 },
      ];
      const bbox = getPolygonBoundingBox(points);
      expect(bbox).toEqual({ minX: 0, maxX: 10, minY: 0, maxY: 10 });
    });

    it('should calculate bounding box for a square', () => {
      const points = [
        { x: -5, y: -5 },
        { x: 5, y: -5 },
        { x: 5, y: 5 },
        { x: -5, y: 5 },
      ];
      const bbox = getPolygonBoundingBox(points);
      expect(bbox).toEqual({ minX: -5, maxX: 5, minY: -5, maxY: 5 });
    });
  });

  describe('polygonBoundingBoxesOverlap', () => {
    it('should return true for overlapping bounding boxes', () => {
      const poly1 = [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ];
      const poly2 = [
        { x: 5, y: 5 },
        { x: 15, y: 15 },
      ];
      expect(polygonBoundingBoxesOverlap(poly1, poly2)).toBe(true);
    });

    it('should return false for non-overlapping bounding boxes', () => {
      const poly1 = [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
      ];
      const poly2 = [
        { x: 10, y: 10 },
        { x: 15, y: 15 },
      ];
      expect(polygonBoundingBoxesOverlap(poly1, poly2)).toBe(false);
    });

    it('should return false if one polygon is empty', () => {
      expect(polygonBoundingBoxesOverlap([], [{ x: 0, y: 0 }])).toBe(false);
      expect(polygonBoundingBoxesOverlap([{ x: 0, y: 0 }], [])).toBe(false);
    });
  });

  describe('isPointInPolygon', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];

    it('should return true for point inside polygon', () => {
      expect(isPointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
    });

    it('should return false for point outside polygon', () => {
      expect(isPointInPolygon({ x: 15, y: 15 }, square)).toBe(false);
    });

    it('should return false for polygon with less than 3 points', () => {
      expect(isPointInPolygon({ x: 5, y: 5 }, [{ x: 0, y: 0 }, { x: 10, y: 10 }])).toBe(false);
    });
  });

  describe('simplifyPolygon', () => {
    it('should remove colinear points', () => {
      const points = [
        { x: 0, y: 0 },
        { x: 5, y: 0 }, // Colinear
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ];
      const simplified = simplifyPolygon(points);
      expect(simplified.length).toBe(4);
      expect(simplified).not.toContainEqual({ x: 5, y: 0 });
    });

    it('should keep points that are not colinear', () => {
        const points = [
            { x: 0, y: 0 },
            { x: 5, y: 5 },
            { x: 10, y: 0 },
        ];
        const simplified = simplifyPolygon(points);
        expect(simplified.length).toBe(3);
    });

    it('should return original points if less than 3', () => {
        const points = [{ x: 0, y: 0 }, { x: 10, y: 10 }];
        expect(simplifyPolygon(points)).toEqual(points);
    });
  });

  describe('perpendicularDistance', () => {
    it('should calculate distance from point to horizontal line', () => {
      const point = { x: 5, y: 5 };
      const start = { x: 0, y: 0 };
      const end = { x: 10, y: 0 };
      expect(perpendicularDistance(point, start, end)).toBe(5);
    });

    it('should calculate distance from point to vertical line', () => {
      const point = { x: 5, y: 5 };
      const start = { x: 0, y: 0 };
      const end = { x: 0, y: 10 };
      expect(perpendicularDistance(point, start, end)).toBe(5);
    });

    it('should handle degenerate case (line is a point)', () => {
        const point = { x: 3, y: 4 };
        const start = { x: 0, y: 0 };
        const end = { x: 0, y: 0 };
        expect(perpendicularDistance(point, start, end)).toBe(5);
    });
  });

  describe('douglasPeucker', () => {
    it('should simplify a zigzag line', () => {
      const points = [
        { x: 0, y: 0 },
        { x: 5, y: 0.1 },
        { x: 10, y: 0 },
      ];
      const simplified = douglasPeucker(points, 1.0);
      expect(simplified.length).toBe(2);
      expect(simplified[0]).toEqual({ x: 0, y: 0 });
      expect(simplified[1]).toEqual({ x: 10, y: 0 });
    });

    it('should keep significant points', () => {
        const points = [
          { x: 0, y: 0 },
          { x: 5, y: 10 },
          { x: 10, y: 0 },
        ];
        const simplified = douglasPeucker(points, 1.0);
        expect(simplified.length).toBe(3);
      });
  });

  describe('calculatePolygonArea', () => {
    it('should calculate area of a 10x10 square', () => {
      const points = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ];
      expect(calculatePolygonArea(points)).toBe(100);
    });

    it('should return 0 for less than 3 points', () => {
        expect(calculatePolygonArea([{ x: 0, y: 0 }, { x: 10, y: 10 }])).toBe(0);
    });
  });

  describe('createCircularPolygon', () => {
    it('should create a polygon with requested number of segments', () => {
      const center = { x: 0, y: 0 };
      const radius = 10;
      const segments = 16;
      const poly = createCircularPolygon(center, radius, segments);
      expect(poly.length).toBe(segments);
      // Check first point (0 degrees)
      expect(poly[0].x).toBeCloseTo(10);
      expect(poly[0].y).toBeCloseTo(0);
    });
  });

  describe('createRectangularPolygon', () => {
    it('should create a rectangle', () => {
      const topLeft = { x: 10, y: 10 };
      const width = 20;
      const height = 30;
      const poly = createRectangularPolygon(topLeft, width, height);
      expect(poly).toEqual([
        { x: 10, y: 10 },
        { x: 30, y: 10 },
        { x: 30, y: 40 },
        { x: 10, y: 40 },
      ]);
    });
  });

  describe('polygonToThreeShape', () => {
    it('should convert points to array of tuples', () => {
      const points = [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ];
      expect(polygonToThreeShape(points)).toEqual([
        [1, 2],
        [3, 4],
      ]);
    });
  });
});
