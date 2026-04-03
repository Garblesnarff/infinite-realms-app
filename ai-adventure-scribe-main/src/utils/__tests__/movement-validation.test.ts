/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect } from 'vitest';

import {
  getMovementCost,
  isMovementBlocked,
  calculateReachableSquares,
  calculatePath,
  pixelToGrid,
  gridToPixel,
  gridDistance,
  type GridCoordinate,
  type TerrainInfo,
  type Wall,
} from '../movement-validation';

import { TokenSize } from '@/types/token';

describe('movement-validation', () => {
  describe('getMovementCost', () => {
    it('should calculate normal movement cost', () => {
      const from: GridCoordinate = { x: 0, y: 0 };
      const to: GridCoordinate = { x: 1, y: 0 };
      const cost = getMovementCost(from, to);
      expect(cost).toBe(5); // 1 square * 5 feet
    });

    it('should calculate diagonal movement cost', () => {
      const from: GridCoordinate = { x: 0, y: 0 };
      const to: GridCoordinate = { x: 1, y: 1 };
      const cost = getMovementCost(from, to);
      expect(cost).toBe(7.5); // 1.5 * 5 feet
    });

    it('should apply difficult terrain cost multiplier', () => {
      const from: GridCoordinate = { x: 0, y: 0 };
      const to: GridCoordinate = { x: 1, y: 0 };
      const terrain = new Map<string, TerrainInfo>();
      terrain.set('1,0', { type: 'difficult', cost: 2 });

      const cost = getMovementCost(from, to, terrain);
      expect(cost).toBe(10); // 5 feet * 2
    });

    it('should handle water terrain without swim speed', () => {
      const from: GridCoordinate = { x: 0, y: 0 };
      const to: GridCoordinate = { x: 1, y: 0 };
      const terrain = new Map<string, TerrainInfo>();
      terrain.set('1,0', { type: 'water', cost: 1 });

      const cost = getMovementCost(from, to, terrain, 'walking');
      expect(cost).toBe(10); // 5 feet * 2
    });

    it('should handle water terrain with swim speed', () => {
      const from: GridCoordinate = { x: 0, y: 0 };
      const to: GridCoordinate = { x: 1, y: 0 };
      const terrain = new Map<string, TerrainInfo>();
      terrain.set('1,0', { type: 'water', cost: 1 });

      const cost = getMovementCost(from, to, terrain, 'swimming');
      expect(cost).toBe(5); // 5 feet * 1
    });

    it('should allow flying to ignore ground terrain', () => {
      const from: GridCoordinate = { x: 0, y: 0 };
      const to: GridCoordinate = { x: 1, y: 0 };
      const terrain = new Map<string, TerrainInfo>();
      terrain.set('1,0', { type: 'difficult', cost: 2 });

      const cost = getMovementCost(from, to, terrain, 'flying');
      expect(cost).toBe(5); // Ignores difficult terrain multiplier
    });

    it('should still be blocked by impassable terrain even when flying', () => {
      const from: GridCoordinate = { x: 0, y: 0 };
      const to: GridCoordinate = { x: 1, y: 0 };
      const terrain = new Map<string, TerrainInfo>();
      terrain.set('1,0', { type: 'impassable', cost: Infinity });

      const cost = getMovementCost(from, to, terrain, 'flying');
      expect(cost).toBe(Infinity);
    });
  });

  describe('isMovementBlocked', () => {
    const walls: Wall[] = [
      {
        from: { x: 0.5, y: -0.5 },
        to: { x: 0.5, y: 0.5 },
        blocks: 'both',
      },
    ];

    it('should detect when movement is blocked by a wall', () => {
      const from: GridCoordinate = { x: 0, y: 0 };
      const to: GridCoordinate = { x: 1, y: 0 };
      expect(isMovementBlocked(from, to, walls)).toBe(true);
    });

    it('should detect when movement is not blocked', () => {
      const from: GridCoordinate = { x: 0, y: 0 };
      const to: GridCoordinate = { x: 0, y: 1 };
      expect(isMovementBlocked(from, to, walls)).toBe(false);
    });

    it('should allow flying to ignore walls (simplified implementation)', () => {
      const from: GridCoordinate = { x: 0, y: 0 };
      const to: GridCoordinate = { x: 1, y: 0 };
      expect(isMovementBlocked(from, to, walls, 'flying')).toBe(false);
    });

    it('should ignore sight-only walls', () => {
      const sightWalls: Wall[] = [
        {
          from: { x: 0.5, y: -0.5 },
          to: { x: 0.5, y: 0.5 },
          blocks: 'sight',
        },
      ];
      const from: GridCoordinate = { x: 0, y: 0 };
      const to: GridCoordinate = { x: 1, y: 0 };
      expect(isMovementBlocked(from, to, sightWalls)).toBe(false);
    });
  });

  describe('calculateReachableSquares', () => {
    const mockToken: any = {
      id: 'token-1',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      size: TokenSize.MEDIUM,
    };

    it('should find reachable squares in an empty area', () => {
      const reachable = calculateReachableSquares(mockToken, 5, []);
      expect(reachable).toHaveLength(5);
      expect(reachable).toContainEqual({ x: 0, y: 0 });
      expect(reachable).toContainEqual({ x: 1, y: 0 });
      expect(reachable).toContainEqual({ x: -1, y: 0 });
      expect(reachable).toContainEqual({ x: 0, y: 1 });
      expect(reachable).toContainEqual({ x: 0, y: -1 });
    });

    it('should respect walls when finding reachable squares', () => {
      const walls: Wall[] = [
        {
          from: { x: 0.5, y: -1 },
          to: { x: 0.5, y: 1 },
          blocks: 'movement',
        },
      ];
      const reachable = calculateReachableSquares(mockToken, 5, walls);
      expect(reachable).not.toContainEqual({ x: 1, y: 0 });
      expect(reachable).toContainEqual({ x: 0, y: 0 });
      expect(reachable).toContainEqual({ x: -1, y: 0 });
    });

    it('should handle difficult terrain', () => {
      const terrain = new Map<string, TerrainInfo>();
      terrain.set('1,0', { type: 'difficult', cost: 2 });

      const reachable = calculateReachableSquares(mockToken, 5, [], terrain);
      expect(reachable).not.toContainEqual({ x: 1, y: 0 });
      expect(reachable).toContainEqual({ x: 0, y: 0 });
    });
  });

  describe('calculatePath', () => {
    it('should find a simple path between two points', () => {
      const from: GridCoordinate = { x: 0, y: 0 };
      const to: GridCoordinate = { x: 2, y: 0 };
      const path = calculatePath(from, to, []);

      expect(path).not.toBeNull();
      expect(path).toHaveLength(3);
      expect(path![0]).toEqual({ x: 0, y: 0 });
      expect(path![1]).toEqual({ x: 1, y: 0 });
      expect(path![2]).toEqual({ x: 2, y: 0 });
    });

    it('should find a path around a wall', () => {
      const simpleWalls: Wall[] = [
        { from: { x: 0.5, y: -0.5 }, to: { x: 0.5, y: 0.5 }, blocks: 'movement' },
      ];
      const path = calculatePath({ x: 0, y: 0 }, { x: 1, y: 0 }, simpleWalls);
      expect(path).not.toBeNull();
      for (let i = 0; i < path!.length - 1; i++) {
        if (path![i].x === 0 && path![i].y === 0 && path![i + 1].x === 1 && path![i + 1].y === 0) {
          throw new Error('Path went through a wall!');
        }
      }
    });

    it('should return null if no path exists', () => {
      const from: GridCoordinate = { x: 0, y: 0 };
      const to: GridCoordinate = { x: 2, y: 0 };

      const robustWalls: Wall[] = [
        { from: { x: -0.6, y: -0.6 }, to: { x: 0.6, y: -0.6 }, blocks: 'movement' },
        { from: { x: 0.6, y: -0.6 }, to: { x: 0.6, y: 0.6 }, blocks: 'movement' },
        { from: { x: 0.6, y: 0.6 }, to: { x: -0.6, y: 0.6 }, blocks: 'movement' },
        { from: { x: -0.6, y: 0.6 }, to: { x: -0.6, y: -0.6 }, blocks: 'movement' },
      ];

      const path = calculatePath(from, to, robustWalls);
      expect(path).toBeNull();
    });
  });

  describe('Utility Functions', () => {
    it('pixelToGrid should convert correctly', () => {
      expect(pixelToGrid(100, 100, 50)).toEqual({ x: 2, y: 2 });
      expect(pixelToGrid(75, 25, 50)).toEqual({ x: 1, y: 0 });
    });

    it('gridToPixel should convert to center of square', () => {
      expect(gridToPixel(2, 2, 50)).toEqual({ x: 125, y: 125 });
    });

    it('gridDistance should calculate distance in feet', () => {
      expect(gridDistance({ x: 0, y: 0 }, { x: 2, y: 0 })).toBe(10);
      expect(gridDistance({ x: 0, y: 0 }, { x: 1, y: 1 })).toBe(5); // D&D 5e distance is max(dx, dy) * 5
    });
  });
});
