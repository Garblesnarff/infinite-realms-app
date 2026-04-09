/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect } from 'vitest';

import { calculateReachableSquares, calculatePath } from '../movement-navigation';
import {
  type GridCoordinate,
  type TerrainInfo,
  type Wall,
} from '../movement-validation';


import { TokenSize } from '@/types/token';

describe('movement-navigation', () => {
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

    it('should handle water with swim speed', () => {
      const terrain = new Map<string, TerrainInfo>();
      terrain.set('1,0', { type: 'water', cost: 1 });
      const capabilities = { speed: 30, swimSpeed: 30 };
      const reachable = calculateReachableSquares(mockToken, 5, [], terrain, capabilities);
      expect(reachable).toContainEqual({ x: 1, y: 0 });
    });

    it('should handle climbing with climb speed', () => {
      const terrain = new Map<string, TerrainInfo>();
      terrain.set('1,0', { type: 'climbing', cost: 1 });
      const capabilities = { speed: 30, climbSpeed: 30 };
      const reachable = calculateReachableSquares(mockToken, 5, [], terrain, capabilities);
      expect(reachable).toContainEqual({ x: 1, y: 0 });
    });

    it('should allow flyers to cross walls', () => {
      const walls: Wall[] = [
        {
          from: { x: 0.5, y: -1 },
          to: { x: 0.5, y: 1 },
          blocks: 'movement',
        },
      ];
      const capabilities = { speed: 30, flySpeed: 60 };
      const reachable = calculateReachableSquares(mockToken, 5, walls, undefined, capabilities);
      expect(reachable).toContainEqual({ x: 1, y: 0 });
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
      // Verify path doesn't go through (0.5, 0)
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

    it('should allow flyers to pathfind through walls', () => {
      const from: GridCoordinate = { x: 0, y: 0 };
      const to: GridCoordinate = { x: 1, y: 0 };
      const walls: Wall[] = [
        { from: { x: 0.5, y: -0.5 }, to: { x: 0.5, y: 0.5 }, blocks: 'movement' },
      ];
      const capabilities = { speed: 30, flySpeed: 60 };

      const path = calculatePath(from, to, walls, undefined, capabilities);

      expect(path).not.toBeNull();
      expect(path).toHaveLength(2);
      expect(path![0]).toEqual({ x: 0, y: 0 });
      expect(path![1]).toEqual({ x: 1, y: 0 });
    });

    it('should handle water with swim speed in pathfinding', () => {
      const from: GridCoordinate = { x: 0, y: 0 };
      const to: GridCoordinate = { x: 1, y: 0 };
      const terrain = new Map<string, TerrainInfo>();
      terrain.set('1,0', { type: 'water', cost: 1 });
      const capabilities = { speed: 30, swimSpeed: 30 };

      const path = calculatePath(from, to, [], terrain, capabilities);
      expect(path).not.toBeNull();
      expect(path).toHaveLength(2);
    });

    it('should handle climbing with climb speed in pathfinding', () => {
      const from: GridCoordinate = { x: 0, y: 0 };
      const to: GridCoordinate = { x: 1, y: 0 };
      const terrain = new Map<string, TerrainInfo>();
      terrain.set('1,0', { type: 'climbing', cost: 1 });
      const capabilities = { speed: 30, climbSpeed: 30 };

      const path = calculatePath(from, to, [], terrain, capabilities);
      expect(path).not.toBeNull();
      expect(path).toHaveLength(2);
    });
  });
});
