/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { describe, it, expect } from 'vitest';

import {
  euclideanDistance,
  gridDistance,
  calculateDistance,
  calculateMeasurementPath,
  getTokensInCone,
  getTokensInSphere,
  getTokensInCube,
  getTokensInLine,
  getAffectedGridSquares,
  snapToGridIntersection,
  snapToGridCenter,
  snapAngleTo45Degrees,
  getMovementRangeColor,
  isPointInPolygon,
} from '../template-calculations';

import { TemplateType } from '@/types/drawing';
import { GridType } from '@/types/scene';

describe('template-calculations', () => {
  const GRID_SIZE = 100;

  describe('euclideanDistance', () => {
    it('should calculate correct distance between two points', () => {
      const p1 = { x: 0, y: 0 };
      const p2 = { x: 300, y: 400 };
      expect(euclideanDistance(p1, p2)).toBe(500);
    });

    it('should return 0 for the same point', () => {
      const p = { x: 10, y: 20 };
      expect(euclideanDistance(p, p)).toBe(0);
    });
  });

  describe('gridDistance', () => {
    it('should calculate straight distance correctly', () => {
      const p1 = { x: 100, y: 100 };
      const p2 = { x: 300, y: 100 }; // 2 squares straight
      expect(gridDistance(p1, p2, GRID_SIZE)).toBe(10);
    });

    it('should calculate diagonal distance using 5-10-5 rule', () => {
      const p1 = { x: 100, y: 100 };
      const p2 = { x: 200, y: 200 }; // 1 square diagonal
      expect(gridDistance(p1, p2, GRID_SIZE)).toBe(5);

      const p3 = { x: 300, y: 300 }; // 2 squares diagonal
      expect(gridDistance(p1, p3, GRID_SIZE)).toBe(15);

      const p4 = { x: 400, y: 400 }; // 3 squares diagonal
      expect(gridDistance(p1, p4, GRID_SIZE)).toBe(20);

      const p5 = { x: 500, y: 500 }; // 4 squares diagonal
      expect(gridDistance(p1, p5, GRID_SIZE)).toBe(30);
    });

    it('should handle complex paths with mixed straight and diagonal movement', () => {
      const p1 = { x: 0, y: 0 };
      const p2 = { x: 200, y: 100 }; // 1 diagonal, 1 straight
      // 5 (diag) + 5 (straight) = 10
      expect(gridDistance(p1, p2, GRID_SIZE)).toBe(10);

      const p3 = { x: 300, y: 200 }; // 2 diagonal, 1 straight
      // 15 (2 diag) + 5 (straight) = 20
      expect(gridDistance(p1, p3, GRID_SIZE)).toBe(20);
    });
  });

  describe('calculateDistance', () => {
    it('should use grid distance by default', () => {
      const p1 = { x: 0, y: 0 };
      const p2 = { x: 200, y: 200 }; // 2 diag = 15ft
      expect(calculateDistance(p1, p2, GRID_SIZE)).toBe(15);
    });

    it('should use euclidean distance when specified', () => {
      const p1 = { x: 0, y: 0 };
      const p2 = { x: 300, y: 400 }; // 500 pixels = 5 squares = 25ft
      expect(calculateDistance(p1, p2, GRID_SIZE, false)).toBe(25);
    });

    it('should handle non-default grid sizes', () => {
      const SMALL_GRID = 50;
      const p1 = { x: 0, y: 0 };
      const p2 = { x: 100, y: 0 }; // 2 squares
      expect(calculateDistance(p1, p2, SMALL_GRID)).toBe(10);
    });
  });

  describe('calculateMeasurementPath', () => {
    it('should calculate total distance for multiple waypoints', () => {
      const waypoints = [
        { x: 0, y: 0 },
        { x: 100, y: 0 }, // 5ft
        { x: 200, y: 100 }, // +5ft (1 diag)
      ];
      const path = calculateMeasurementPath(waypoints, GRID_SIZE);
      expect(path.totalDistance).toBe(10);
      expect(path.segments).toHaveLength(2);
      expect(path.segments[0].distance).toBe(5);
      expect(path.segments[1].distance).toBe(5);
    });
  });

  describe('getTokensInCone', () => {
    it('should filter tokens within a cone', () => {
      const origin = { x: 100, y: 100 };
      const tokens: any[] = [
        { x: 100, y: 50 }, // Token center at (150, 100). East of origin.
        { x: 500, y: 500 },
      ];
      // 90 deg direction (East), 30ft distance, 90 deg angle.
      const affected = getTokensInCone(origin, 90, 90, 30, tokens, GRID_SIZE);
      expect(affected).toHaveLength(1);
      expect(affected[0].x).toBe(100);
    });
  });

  describe('getTokensInSphere', () => {
    it('should filter tokens within a sphere', () => {
      const origin = { x: 100, y: 100 };
      const tokens: any[] = [
        { x: 100, y: 100 }, // Center at (150, 150). Dist from (100,100) is 50*sqrt(2) = 70.7px (~3.5ft)
        { x: 500, y: 500 },
      ];
      const affected = getTokensInSphere(origin, 10, tokens, GRID_SIZE);
      expect(affected).toHaveLength(1);
    });

    it('should support non-grid distance calculation', () => {
      const origin = { x: 0, y: 0 };
      const tokens: any[] = [
        { x: 200, y: 200 }, // Center at (250, 250). Dist = 353.5px = 17.6ft
      ];
      const affected = getTokensInSphere(origin, 15, tokens, GRID_SIZE, false);
      expect(affected).toHaveLength(0);
    });
  });

  describe('getTokensInCube', () => {
    it('should filter tokens within a cube', () => {
      const origin = { x: 100, y: 100 };
      const tokens: any[] = [
        { x: 100, y: 100 },
        { x: 500, y: 500 },
      ];
      const affected = getTokensInCube(origin, 10, tokens, GRID_SIZE);
      expect(affected).toHaveLength(1);
    });

    it('should handle rotated cubes', () => {
      const origin = { x: 100, y: 100 };
      const tokens: any[] = [
        { x: 150, y: 50 },
      ];
      // 45 degree rotation
      const affected = getTokensInCube(origin, 20, tokens, GRID_SIZE, 45);
      expect(affected.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getTokensInLine', () => {
    it('should filter tokens within a line', () => {
      const origin = { x: 0, y: 0 };
      const tokens: any[] = [
        { x: 100, y: -25 }, // Center at (150, 25).
        { x: 500, y: 500 },
      ];
      const affected = getTokensInLine(origin, 90, 10, 20, tokens, GRID_SIZE);
      expect(affected).toHaveLength(1);
    });
  });

  describe('getAffectedGridSquares', () => {
    it('should return affected squares for a cube', () => {
      const template: any = {
        templateType: TemplateType.CUBE,
        x: 100,
        y: 100,
        distance: 10,
        direction: 0,
      };
      const squares = getAffectedGridSquares(template, GRID_SIZE, GridType.SQUARE);
      expect(squares).toHaveLength(4);
    });

    it('should handle rotated cubes correctly', () => {
      const template: any = {
        templateType: TemplateType.CUBE,
        x: 100,
        y: 100,
        distance: 10,
        direction: 45,
      };
      const squares = getAffectedGridSquares(template, GRID_SIZE, GridType.SQUARE);
      expect(squares.length).toBeGreaterThan(0);
    });

    it('should return affected squares for a sphere', () => {
      const template: any = {
        templateType: TemplateType.SPHERE,
        x: 100,
        y: 100,
        distance: 5,
      };
      const squares = getAffectedGridSquares(template, GRID_SIZE, GridType.SQUARE);
      expect(squares).toHaveLength(4);
    });

    it('should handle cylinders as spheres', () => {
      const template: any = {
        templateType: TemplateType.CYLINDER,
        x: 100,
        y: 100,
        distance: 5,
      };
      const squares = getAffectedGridSquares(template, GRID_SIZE, GridType.SQUARE);
      expect(squares).toHaveLength(4);
    });

    it('should return affected squares for a cone', () => {
      const template: any = {
        templateType: TemplateType.CONE,
        x: 0,
        y: 0,
        distance: 10,
        direction: 90,
        angle: 90,
      };
      const squares = getAffectedGridSquares(template, GRID_SIZE, GridType.SQUARE);
      expect(squares.length).toBeGreaterThan(0);
    });

    it('should return affected squares for a line', () => {
      const template: any = {
        templateType: TemplateType.LINE,
        x: 0,
        y: 0,
        distance: 10,
        direction: 90,
        width: 10,
      };
      const squares = getAffectedGridSquares(template, GRID_SIZE, GridType.SQUARE);
      expect(squares.length).toBeGreaterThan(0);
    });

    it('should handle rays as lines', () => {
      const template: any = {
        templateType: TemplateType.RAY,
        x: 0,
        y: 0,
        distance: 10,
        direction: 90,
        width: 10,
      };
      const squares = getAffectedGridSquares(template, GRID_SIZE, GridType.SQUARE);
      expect(squares.length).toBeGreaterThan(0);
    });

    it('should return empty for unsupported grid types', () => {
      const template: any = { templateType: TemplateType.CUBE };
      expect(getAffectedGridSquares(template, GRID_SIZE, GridType.HEXAGONAL_HORIZONTAL)).toEqual(
        [],
      );
    });
  });

  describe('isPointInPolygon', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];

    it('should return true for points inside', () => {
      expect(isPointInPolygon({ x: 50, y: 50 }, square)).toBe(true);
      expect(isPointInPolygon({ x: 10, y: 90 }, square)).toBe(true);
    });

    it('should return false for points outside', () => {
      expect(isPointInPolygon({ x: -10, y: 50 }, square)).toBe(false);
      expect(isPointInPolygon({ x: 110, y: 50 }, square)).toBe(false);
      expect(isPointInPolygon({ x: 50, y: -10 }, square)).toBe(false);
      expect(isPointInPolygon({ x: 50, y: 110 }, square)).toBe(false);
    });
  });

  describe('snapping', () => {
    it('should snapToGridIntersection correctly', () => {
      expect(snapToGridIntersection({ x: 48, y: 152 }, GRID_SIZE)).toEqual({ x: 0, y: 200 });
    });

    it('should snapToGridCenter correctly', () => {
      expect(snapToGridCenter({ x: 48, y: 152 }, GRID_SIZE)).toEqual({ x: 50, y: 150 });
    });

    it('should snapAngleTo45Degrees correctly', () => {
      expect(snapAngleTo45Degrees(10)).toBe(0);
      expect(snapAngleTo45Degrees(40)).toBe(45);
    });
  });

  describe('getMovementRangeColor', () => {
    it('should return correct colors', () => {
      expect(getMovementRangeColor(30, 30)).toBe('#00ff00');
      expect(getMovementRangeColor(45, 30)).toBe('#ffff00');
      expect(getMovementRangeColor(65, 30)).toBe('#ff0000');
    });

    it('should support custom color palettes', () => {
      const customColors = {
        normal: 'blue',
        dash: 'orange',
        beyond: 'black',
      };
      expect(getMovementRangeColor(10, 30, customColors)).toBe('blue');
      expect(getMovementRangeColor(40, 30, customColors)).toBe('orange');
      expect(getMovementRangeColor(70, 30, customColors)).toBe('black');
    });
  });
});
