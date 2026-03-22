/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';

import {
  calculateLightPolygon,
  calculateShadows,
  calculateAmbientOcclusion,
  calculateSceneLighting,
  isPointInLight,
} from '../lighting-integration';

import { TokenSize, TokenType, NameplatePosition } from '@/types/token';

describe('lighting-integration', () => {
  const mockToken = (x: number, y: number, lightRange: number, dimLightRange: number): any => ({
    id: 'token-1',
    x,
    y,
    light: {
      emitsLight: true,
      lightRange,
      dimLightRange,
      lightColor: '#ffffff',
      luminosity: 0.5,
    },
    // Required fields for Token type if we were strictly following it
    sceneId: 'scene-1',
    name: 'Torch',
    tokenType: TokenType.OBJECT,
    elevation: 0,
    imageUrl: '',
    width: 1,
    height: 1,
    size: TokenSize.MEDIUM,
    scale: 1,
    rotation: 0,
    alpha: 1,
    displayName: true,
    nameplate: NameplatePosition.BOTTOM,
    nameVisibility: 'all',
    displayBars: 'none',
    bar1: { attribute: 'hp', value: 10, max: 10, visible: false },
    statusEffects: [],
    conditions: [],
    disposition: 1,
    lockRotation: false,
    hidden: false,
    locked: false,
    ownerIds: [],
    observerIds: [],
    createdBy: 'user-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const mockWall = (points: { x: number; y: number }[]): any => ({
    id: 'wall-1',
    points,
    blocksLight: true,
    blocksMovement: true,
  });

  describe('calculateLightPolygon', () => {
    it('should return nulls if token does not emit light', () => {
      const token = mockToken(100, 100, 20, 20);
      token.light.emitsLight = false;
      const result = calculateLightPolygon(token, []);
      expect(result.bright).toBeNull();
      expect(result.dim).toBeNull();
    });

    it('should calculate light polygons without walls', () => {
      const token = mockToken(100, 100, 2, 2); // 2ft bright, 2ft dim = 40px, 40px
      const result = calculateLightPolygon(token, []);

      expect(result.bright).not.toBeNull();
      expect(result.dim).not.toBeNull();

      // Without walls, it should approximate a circle
      expect(result.bright?.points.length).toBeGreaterThan(0);
      expect(result.dim?.points.length).toBeGreaterThan(0);
    });

    it('should respect light-blocking walls', () => {
      const token = mockToken(100, 100, 5, 0); // 100px bright
      const wall = mockWall([
        { x: 150, y: 50 },
        { x: 150, y: 150 },
      ]);

      const result = calculateLightPolygon(token, [wall]);

      expect(result.bright).not.toBeNull();
      // Some points should be on the wall at x=150
      const pointsOnWall = result.bright?.points.filter(p => Math.abs(p.x - 150) < 0.1);
      expect(pointsOnWall?.length).toBeGreaterThan(0);
    });
  });

  describe('calculateShadows', () => {
    it('should return empty array if token does not emit light', () => {
      const token = mockToken(100, 100, 20, 20);
      token.light.emitsLight = false;
      const result = calculateShadows(token, []);
      expect(result).toEqual([]);
    });

    it('should calculate shadow polygons for walls', () => {
      const token = mockToken(100, 100, 5, 0);
      const wall = mockWall([
        { x: 150, y: 50 },
        { x: 150, y: 150 },
      ]);

      const result = calculateShadows(token, [wall]);
      expect(result.length).toBe(1);
      expect(result[0].points.length).toBe(4); // Shadow quad
      expect(result[0].opacity).toBe(0.7);
    });
  });

  describe('isPointInLight', () => {
    it('should return true for point within light range and not blocked', () => {
      const token = mockToken(100, 100, 5, 5); // 200px total range
      const result = isPointInLight({ x: 150, y: 100 }, [token], []);
      expect(result).toBe(true);
    });

    it('should return false for point outside light range', () => {
      const token = mockToken(100, 100, 1, 1); // 40px total range
      const result = isPointInLight({ x: 200, y: 100 }, [token], []);
      expect(result).toBe(false);
    });

    it('should return false if point is blocked by a wall', () => {
      const token = mockToken(100, 100, 10, 0);
      const wall = mockWall([
        { x: 120, y: 50 },
        { x: 120, y: 150 },
      ]);

      const result = isPointInLight({ x: 150, y: 100 }, [token], [wall]);
      expect(result).toBe(false);
    });
  });

  describe('calculateAmbientOcclusion', () => {
    it('should generate a grid of occlusion values', () => {
      const bounds = { minX: 0, minY: 0, maxX: 200, maxY: 200 };
      const grid = calculateAmbientOcclusion(bounds, [], 100, 50);

      expect(grid.length).toBe(2); // 200 / 100
      expect(grid[0].length).toBe(2);
      expect(grid[0][0]).toBe(1); // No walls, fully lit
    });

    it('should account for walls in occlusion calculation', () => {
      const bounds = { minX: 0, minY: 0, maxX: 200, maxY: 200 };
      const wall = mockWall([
        { x: 50, y: 0 },
        { x: 50, y: 200 },
      ]);

      const grid = calculateAmbientOcclusion(bounds, [wall], 100, 100);
      // Point at (0,0) should be partially occluded by wall at x=50
      expect(grid[0][0]).toBeLessThan(1);
    });
  });

  describe('calculateSceneLighting', () => {
    it('should combine lighting data for multiple sources', () => {
      const tokens = [
        mockToken(100, 100, 5, 5),
        mockToken(300, 300, 5, 5),
      ];
      const walls = [
        mockWall([{ x: 200, y: 0 }, { x: 200, y: 400 }])
      ];

      const result = calculateSceneLighting(tokens, walls);
      expect(result.brightLightPolygons.length).toBe(2);
      expect(result.dimLightPolygons.length).toBe(2);
      expect(result.shadows.length).toBeGreaterThan(0);
    });
  });
});
