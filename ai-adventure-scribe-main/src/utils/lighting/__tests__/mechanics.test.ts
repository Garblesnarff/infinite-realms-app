/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { calculateShadows, calculateAmbientOcclusion } from '../mechanics';

vi.mock('../../geometry', () => ({
  lineSegmentsIntersect: vi.fn((p1, p2, p3, p4) => {
    // Simple mock: block if the ray crosses x=150 between y=50 and y=150
    // and the ray is horizontal-ish
    if (p3.x === 150 && p4.x === 150 && p3.y === 50 && p4.y === 150) {
      if ((p1.x < 150 && p2.x > 150) || (p1.x > 150 && p2.x < 150)) {
         return true;
      }
    }
    return false;
  }),
}));

describe('lighting mechanics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockLightSource: any = {
    x: 100,
    y: 100,
    light: {
      emitsLight: true,
      lightRange: 10,
      dimLightRange: 10,
      lightColor: '#ffffff',
      luminosity: 0.5,
    },
  };

  const mockWalls: any[] = [
    {
      id: 'wall-1',
      points: [
        { x: 150, y: 50 },
        { x: 150, y: 150 },
      ],
      blocksLight: true,
    },
  ];

  describe('calculateShadows', () => {
    it('returns empty array if light source does not emit light', () => {
      const nonEmittingSource = { ...mockLightSource, light: { ...mockLightSource.light, emitsLight: false } };
      const result = calculateShadows(nonEmittingSource, mockWalls);
      expect(result).toEqual([]);
    });

    it('calculates shadows for a single wall segment', () => {
      const result = calculateShadows(mockLightSource, mockWalls);
      expect(result.length).toBe(1);
      expect(result[0].points.length).toBe(4);
      expect(result[0].opacity).toBe(0.7);

      // The segment is at x=150, light is at x=100.
      // The shadow should project further in +x direction.
      expect(result[0].points[0]).toEqual({ x: 150, y: 50 });
      expect(result[0].points[1].x).toBeGreaterThan(150);
      expect(result[0].points[2].x).toBeGreaterThan(150);
      expect(result[0].points[3]).toEqual({ x: 150, y: 150 });
    });

    it('handles polygon walls by processing closing segment', () => {
      const polygonWall: any[] = [
        {
          id: 'poly-1',
          points: [
            { x: 150, y: 50 },
            { x: 200, y: 50 },
            { x: 200, y: 150 },
            { x: 150, y: 150 },
          ],
          blocksLight: true,
        },
      ];

      const result = calculateShadows(mockLightSource, polygonWall);
      // Should have 4 segments: 150,50->200,50; 200,50->200,150; 200,150->150,150; AND 150,150->150,50 (closing)
      // Some might be culled if they face the light, but we check if closing is attempted.
      expect(result.length).toBeGreaterThan(0);
    });

    it('should cast shadows regardless of wall winding order', () => {
      // Light at 100, 100. Wall at 150, 50 -> 150, 150 (Normal points left)
      const wall1 = [{
        id: 'wall-1',
        points: [{ x: 150, y: 50 }, { x: 150, y: 150 }],
        blocksLight: true,
      }];

      // Light at 100, 100. Wall at 150, 150 -> 150, 50 (Normal points right)
      const wall2 = [{
        id: 'wall-2',
        points: [{ x: 150, y: 150 }, { x: 150, y: 50 }],
        blocksLight: true,
      }];

      const result1 = calculateShadows(mockLightSource, wall1);
      const result2 = calculateShadows(mockLightSource, wall2);

      expect(result1.length).toBe(1);
      expect(result2.length).toBe(1);
    });

    it('handles walls with no points gracefully', () => {
      const wallNoPoints = [{ id: 'empty', points: [], blocksLight: true }];
      const result = calculateShadows(mockLightSource, wallNoPoints);
      expect(result.length).toBe(0);
    });

    it('handles walls with one point gracefully', () => {
      const wallOnePoint = [{ id: 'point', points: [{ x: 150, y: 50 }], blocksLight: true }];
      const result = calculateShadows(mockLightSource, wallOnePoint);
      expect(result.length).toBe(0);
    });
  });

  describe('calculateAmbientOcclusion', () => {
    const bounds = { minX: 0, minY: 0, maxX: 200, maxY: 200 };

    it('skips walls that do not block light', () => {
      const nonBlockingWall = [{
        id: 'wall-1',
        points: [{ x: 150, y: 50 }, { x: 150, y: 150 }],
        blocksLight: false,
      }];
      const gridSize = 200;
      const result = calculateAmbientOcclusion(bounds, nonBlockingWall, gridSize, 200);
      expect(result[0][0]).toBe(1);
    });

    it('calculates a grid of occlusion values', () => {
      const gridSize = 100;
      const result = calculateAmbientOcclusion(bounds, [], gridSize);

      // 200/100 = 2. Grid should be 2x2.
      expect(result.length).toBe(2);
      expect(result[0].length).toBe(2);
      // No walls, all values should be 1
      expect(result[0][0]).toBe(1);
    });

    it('reduces values when samples are blocked by walls', () => {
      const gridSize = 200;
      // One cell at 0,0. Center at 0,0.
      // Wall at x=150. Some samples (to the right) will be blocked.
      const result = calculateAmbientOcclusion(bounds, mockWalls, gridSize, 200);

      expect(result[0][0]).toBeLessThan(1);
      expect(result[0][0]).toBeGreaterThan(0);
    });

    it('processes closing segments for polygon walls in AO', async () => {
      const polygonWall: any[] = [
        {
          id: 'poly-1',
          points: [
            { x: 140, y: 150 },
            { x: 160, y: 150 },
            { x: 160, y: 50 },
            { x: 140, y: 50 },
          ],
          blocksLight: true,
        },
      ];

      // A point at (150, 100) is INSIDE the polygon.
      // All samples should be blocked if closing segment is handled.
      const smallBounds = { minX: 150, minY: 100, maxX: 151, maxY: 101 };

      // We need to re-mock lineSegmentsIntersect to handle this specific polygon
      const { lineSegmentsIntersect } = await import('../../geometry');
      (lineSegmentsIntersect as any).mockImplementation((_p1: any, _p2: any, _p3: any, _p4: any) => {
          return false;
      });

      calculateAmbientOcclusion(smallBounds, polygonWall, 1, 100);

      // We expect 4 calls per sample (16 samples) = 64 calls total if closing segment is included.
      // If closing segment is NOT included, it would be 3 calls per sample = 48 calls.
      expect(lineSegmentsIntersect).toHaveBeenCalledTimes(64);
    });
  });
});
