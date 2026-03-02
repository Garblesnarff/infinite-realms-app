import { describe, it, expect } from 'vitest';

import {
  snapToGrid,
  worldToGrid,
  gridToWorld,
  worldToHex,
  hexToWorld,
  roundHexCoordinates,
  getHexGridPoints,
  getHexesInArea,
  hexDistance,
} from '../grid-snapping';

import { GridType } from '@/types/scene';

describe('grid-snapping utilities', () => {
  describe('snapToGrid', () => {
    it('should return same coordinates for GRIDLESS', () => {
      const result = snapToGrid(123, 456, 100, GridType.GRIDLESS);
      expect(result).toEqual({ x: 123, y: 456 });
    });

    it('should snap to nearest grid point for SQUARE', () => {
      expect(snapToGrid(40, 60, 100, GridType.SQUARE)).toEqual({ x: 0, y: 100 });
      expect(snapToGrid(155, 245, 100, GridType.SQUARE)).toEqual({ x: 200, y: 200 });
    });

    it('should snap for HEXAGONAL_VERTICAL (pointy)', () => {
      const gridSize = 100;
      const result = snapToGrid(10, 10, gridSize, GridType.HEXAGONAL_VERTICAL);
      // Center of hex at 0,0 is 0,0
      expect(result.x).toBeCloseTo(0);
      expect(result.y).toBeCloseTo(0);

      const result2 = snapToGrid(160, 10, gridSize, GridType.HEXAGONAL_VERTICAL);
      // q=1, r=0 in pointy hex should be at x = gridSize * sqrt(3), y = 0
      expect(result2.x).toBeCloseTo(173.205, 1);
      expect(result2.y).toBeCloseTo(0);
    });

    it('should snap for HEXAGONAL_HORIZONTAL (flat)', () => {
      const gridSize = 100;
      const result = snapToGrid(10, 10, gridSize, GridType.HEXAGONAL_HORIZONTAL);
      expect(result.x).toBeCloseTo(0);
      expect(result.y).toBeCloseTo(0);
    });
  });

  describe('worldToGrid / gridToWorld', () => {
    it('should convert coordinates correctly', () => {
      const gridSize = 100;
      expect(worldToGrid(150, 250, gridSize)).toEqual({ col: 1, row: 2 });
      expect(gridToWorld(1, 2, gridSize)).toEqual({ x: 150, y: 250 });
    });
  });

  describe('hex coordinate conversion', () => {
    const gridSize = 100;

    it('should convert pointy worldToHex and hexToWorld', () => {
      const q = 1;
      const r = 2;
      const world = hexToWorld(q, r, gridSize, 'pointy');
      const hex = worldToHex(world.x, world.y, gridSize, 'pointy');

      expect(hex.q).toBeCloseTo(q);
      expect(hex.r).toBeCloseTo(r);
    });

    it('should convert flat worldToHex and hexToWorld correctly', () => {
      const q = 2;
      const r = 1;
      const world = hexToWorld(q, r, gridSize, 'flat');

      // Expected for flat-top:
      // x = gridSize * 3/2 * q = 100 * 1.5 * 2 = 300
      // y = gridSize * (sqrt(3)/2 * q + sqrt(3) * r) = 100 * (0.866 * 2 + 1.732 * 1) = 100 * (1.732 + 1.732) = 346.41

      expect(world.x).toBeCloseTo(300);
      // This expectation will FAIL before the bug fix
      expect(world.y).toBeCloseTo(346.41, 1);

      const hex = worldToHex(world.x, world.y, gridSize, 'flat');
      expect(hex.q).toBeCloseTo(q);
      expect(hex.r).toBeCloseTo(r);
    });
  });

  describe('roundHexCoordinates', () => {
    it('should round to nearest hex correctly', () => {
      expect(roundHexCoordinates(0.1, 0.2)).toEqual({ q: 0, r: 0 });
      expect(roundHexCoordinates(0.9, 1.1)).toEqual({ q: 1, r: 1 });
      // Test cases where rounding errors are handled
      expect(roundHexCoordinates(0.6, 0.6)).toEqual({ q: 1, r: 0 }); // y = -1.2 -> ry = -1, rx=1, rz=1 -> total 1. Adjust rx to -ry-rz = 0?
      // Actually x=0.6, z=0.6, y=-1.2. rx=1, rz=1, ry=-1. Sum = 1.
      // xDiff = 0.4, yDiff = 0.2, zDiff = 0.4.
      // If xDiff == zDiff and they are max, it goes to last else: rz = -rx-ry = -1 - (-1) = 0.
      // So {q: 1, r: 0}.
    });
  });

  describe('getHexGridPoints', () => {
    it('should return 6 points for a hex (pointy)', () => {
      const points = getHexGridPoints(0, 0, 100, 'pointy');
      expect(points).toHaveLength(6);
    });

    it('should return 6 points for a hex (flat)', () => {
      const points = getHexGridPoints(0, 0, 100, 'flat');
      expect(points).toHaveLength(6);
    });
  });

  describe('getHexesInArea', () => {
    it('should return hexes within an area', () => {
      const hexes = getHexesInArea(200, 200, 100, 'pointy');
      expect(hexes.length).toBeGreaterThan(0);
    });
  });

  describe('hexDistance', () => {
    it('should calculate distance correctly', () => {
      expect(hexDistance(0, 0, 1, 0)).toBe(1);
      expect(hexDistance(0, 0, 0, 1)).toBe(1);
      expect(hexDistance(0, 0, 1, -1)).toBe(1);
      expect(hexDistance(0, 0, 2, 0)).toBe(2);
    });
  });
});
