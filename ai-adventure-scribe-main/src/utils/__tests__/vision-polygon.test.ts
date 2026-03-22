/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import * as geometry from '../geometry';
import * as raycasting from '../raycasting';
import * as visionCalculations from '../vision-calculations';
import { calculateVisionPolygon, hasLineOfSight, mergeVisionPolygons } from '../vision-polygon';

import type { VisionBlocker } from '@/types/scene';
import type { Token } from '@/types/token';

// Mock dependencies
vi.mock('../geometry', () => ({
  isLineBlocked: vi.fn(),
  isPointInVisionCone: vi.fn(),
}));

vi.mock('../raycasting', () => ({
  getAllRayIntersections: vi.fn(),
  removeDuplicatePoints: vi.fn((points) => points),
  sortEndpointsByAngle: vi.fn((endpoints) => endpoints),
}));

vi.mock('../vision-calculations', () => ({
  calculateVisionRadius: vi.fn(),
}));

describe('vision-polygon', () => {
  const createMockToken = (overrides: any = {}): Token =>
    ({
      id: 'token-1',
      x: 100,
      y: 100,
      rotation: 0,
      vision: {
        enabled: true,
        range: 60,
        angle: 360,
        visionMode: 'basic',
      },
      ...overrides,
    }) as any as Token;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('calculateVisionPolygon', () => {
    it('should return empty points if vision is disabled', () => {
      const token = createMockToken({ vision: { enabled: false } });
      const result = calculateVisionPolygon(token, []);
      expect(result.points).toEqual([]);
      expect(result.range).toBe(0);
    });

    it('should calculate vision polygon with 360 degree vision', () => {
      const token = createMockToken({ vision: { enabled: true, range: 60, angle: 360 } });
      const mockPoints = [
        { point: { x: 160, y: 100 } },
        { point: { x: 100, y: 160 } },
        { point: { x: 40, y: 100 } },
        { point: { x: 100, y: 40 } },
      ];

      vi.mocked(visionCalculations.calculateVisionRadius).mockReturnValue(60);
      vi.mocked(raycasting.getAllRayIntersections).mockReturnValue(mockPoints as any);
      vi.mocked(raycasting.sortEndpointsByAngle).mockReturnValue(mockPoints as any);

      const result = calculateVisionPolygon(token, []);

      expect(result.points).toHaveLength(5); // Including closed loop
      expect(result.points[0]).toEqual({ x: 160, y: 100 });
      expect(result.points[4]).toEqual({ x: 160, y: 100 }); // Closed
      expect(result.range).toBe(1200); // 60 * 20
      expect(result.visionMode).toBe('basic');
    });

    it('should clip polygon to vision cone', () => {
      const token = createMockToken({
        vision: { enabled: true, range: 60, angle: 90 },
        rotation: 0
      });
      const mockPoints = [
        { point: { x: 160, y: 100 } }, // In cone
        { point: { x: 40, y: 100 } },  // Out of cone
      ];

      vi.mocked(visionCalculations.calculateVisionRadius).mockReturnValue(60);
      vi.mocked(raycasting.getAllRayIntersections).mockReturnValue(mockPoints as any);
      vi.mocked(geometry.isPointInVisionCone).mockImplementation((origin, rot, angle, pt) => pt.x > 100);

      const result = calculateVisionPolygon(token, []);

      // Origin, Start edge, In-cone point, End edge, Origin (to close)
      // Actually the implementation adds origin at the end.
      expect(result.points).toContainEqual({ x: 100, y: 100 });
      expect(result.coneAngle).toBe(90);
      expect(result.rotation).toBe(0);
    });

    it('should filter walls for truesight', () => {
      const token = createMockToken({ vision: { enabled: true, visionMode: 'truesight' } });
      const walls: VisionBlocker[] = [
        { id: 'w1', blocksLight: true, blocksMovement: false } as any, // Transparent/Soft
        { id: 'w2', blocksLight: true, blocksMovement: true } as any,  // Hard
      ];

      vi.mocked(visionCalculations.calculateVisionRadius).mockReturnValue(60);

      calculateVisionPolygon(token, walls);

      expect(raycasting.getAllRayIntersections).toHaveBeenCalledWith(
        expect.anything(),
        expect.arrayContaining([expect.objectContaining({ id: 'w2' })]),
        expect.anything()
      );
      const filteredWalls = vi.mocked(raycasting.getAllRayIntersections).mock.calls[0][1];
      expect(filteredWalls).toHaveLength(1);
      expect(filteredWalls[0].id).toBe('w2');
    });

    it('should ignore all walls for tremorsense', () => {
      const token = createMockToken({ vision: { enabled: true, visionMode: 'tremorsense' } });
      const walls: VisionBlocker[] = [{ id: 'w1', blocksLight: true } as any];

      vi.mocked(visionCalculations.calculateVisionRadius).mockReturnValue(60);

      calculateVisionPolygon(token, walls);

      expect(raycasting.getAllRayIntersections).toHaveBeenCalledWith(
        expect.anything(),
        [],
        expect.anything()
      );
    });
  });

  describe('hasLineOfSight', () => {
    it('should call isLineBlocked without quadtree', () => {
      const from = { x: 0, y: 0 };
      const to = { x: 10, y: 10 };
      const walls = [] as any[];

      vi.mocked(geometry.isLineBlocked).mockReturnValue(false);

      const result = hasLineOfSight(from, to, walls);

      expect(result).toBe(true);
      expect(geometry.isLineBlocked).toHaveBeenCalledWith(from, to, walls);
    });

    it('should use quadtree when provided', () => {
      const from = { x: 0, y: 0 };
      const to = { x: 10, y: 10 };
      const walls = [{ id: 'w1' }] as any[];
      const quadTree = {
        queryLine: vi.fn().mockReturnValue(walls),
      };

      vi.mocked(geometry.isLineBlocked).mockReturnValue(false);

      const result = hasLineOfSight(from, to, [], quadTree);

      expect(result).toBe(true);
      expect(quadTree.queryLine).toHaveBeenCalledWith(from, to);
      expect(geometry.isLineBlocked).toHaveBeenCalledWith(from, to, walls);
    });
  });

  describe('mergeVisionPolygons', () => {
    it('should return empty result for empty input', () => {
      const result = mergeVisionPolygons([]);
      expect(result.points).toEqual([]);
    });

    it('should return the same polygon for single input', () => {
      const poly = { points: [{ x: 0, y: 0 }], range: 10, visionMode: 'basic' } as any;
      const result = mergeVisionPolygons([poly]);
      expect(result).toEqual(poly);
    });

    it('should merge multiple polygons using convex hull', () => {
      const poly1 = { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }], range: 10 } as any;
      const poly2 = { points: [{ x: 10, y: 10 }], range: 20 } as any;

      const result = mergeVisionPolygons([poly1, poly2]);

      expect(result.range).toBe(20);
      expect(result.points.length).toBeGreaterThan(0);
      // Convex hull of (0,0), (10,0), (0,10), (10,10) is a square
      expect(result.points).toContainEqual({ x: 0, y: 0 });
      expect(result.points).toContainEqual({ x: 10, y: 0 });
      expect(result.points).toContainEqual({ x: 10, y: 10 });
      expect(result.points).toContainEqual({ x: 0, y: 10 });
    });
  });
});
