/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { TokenSize } from '@/types/token';
import {
  getTokenDimensions,
  getTokenScale,
  centerTokenOnGrid,
  pixelToGrid,
  snapToGrid,
  getBorderWidth,
  getNameplateOffset
} from '../token-sizing';

describe('token-sizing utilities', () => {
  const GRID_SIZE = 100;

  describe('getTokenDimensions', () => {
    it('should return correct dimensions for MEDIUM token', () => {
      const dims = getTokenDimensions(TokenSize.MEDIUM, GRID_SIZE);
      expect(dims).toEqual({
        width: 1,
        height: 1,
        pixelWidth: 100,
        pixelHeight: 100
      });
    });

    it('should return correct dimensions for LARGE token', () => {
      const dims = getTokenDimensions(TokenSize.LARGE, GRID_SIZE);
      expect(dims).toEqual({
        width: 2,
        height: 2,
        pixelWidth: 200,
        pixelHeight: 200
      });
    });

    it('should return correct dimensions for TINY token', () => {
      const dims = getTokenDimensions(TokenSize.TINY, GRID_SIZE);
      expect(dims).toEqual({
        width: 0.5,
        height: 0.5,
        pixelWidth: 50,
        pixelHeight: 50
      });
    });

    it('should allow custom dimension overrides', () => {
      const dims = getTokenDimensions(TokenSize.MEDIUM, GRID_SIZE, 2, 3);
      expect(dims).toEqual({
        width: 2,
        height: 3,
        pixelWidth: 200,
        pixelHeight: 300
      });
    });
  });

  describe('getTokenScale', () => {
    it('should return 1 for MEDIUM', () => {
      expect(getTokenScale(TokenSize.MEDIUM)).toBe(1);
    });
    it('should return 2 for LARGE', () => {
      expect(getTokenScale(TokenSize.LARGE)).toBe(2);
    });
    it('should return 0.5 for TINY', () => {
      expect(getTokenScale(TokenSize.TINY)).toBe(0.5);
    });
  });

  describe('centerTokenOnGrid', () => {
    it('should return gridX * gridSize for MEDIUM token (buggy behavior?)', () => {
      const pos = centerTokenOnGrid(5, 10, TokenSize.MEDIUM, GRID_SIZE);
      // current logic: (5 + (1-1)/2) * 100 = 500
      expect(pos).toEqual({ x: 500, y: 1000 });
    });

    it('should return (gridX + 0.5) * gridSize for LARGE token', () => {
      const pos = centerTokenOnGrid(5, 10, TokenSize.LARGE, GRID_SIZE);
      // current logic: (5 + (2-1)/2) * 100 = 550
      expect(pos).toEqual({ x: 550, y: 1050 });
    });

    it('should return (gridX - 0.25) * gridSize for TINY token', () => {
      const pos = centerTokenOnGrid(5, 10, TokenSize.TINY, GRID_SIZE);
      // current logic: (5 + (0.5-1)/2) * 100 = 475
      expect(pos).toEqual({ x: 475, y: 975 });
    });
  });

  describe('pixelToGrid', () => {
    it('should convert pixels to grid coordinates', () => {
      expect(pixelToGrid(550, 1050, GRID_SIZE)).toEqual({ x: 5, y: 10 });
      expect(pixelToGrid(500, 1000, GRID_SIZE)).toEqual({ x: 5, y: 10 });
      expect(pixelToGrid(599, 1099, GRID_SIZE)).toEqual({ x: 5, y: 10 });
    });

    it('should handle negative coordinates', () => {
      expect(pixelToGrid(-50, -150, GRID_SIZE)).toEqual({ x: -1, y: -2 });
    });
  });

  describe('snapToGrid', () => {
    it('should snap MEDIUM token to top-left of cell', () => {
      const snapped = snapToGrid(547, 1053, TokenSize.MEDIUM, GRID_SIZE);
      expect(snapped).toEqual({ x: 500, y: 1000 });
    });

    it('should snap LARGE token to center of cell (as per current implementation)', () => {
      const snapped = snapToGrid(547, 1053, TokenSize.LARGE, GRID_SIZE);
      expect(snapped).toEqual({ x: 550, y: 1050 });
    });
  });

  describe('getBorderWidth', () => {
    it('should return baseBorderWidth for MEDIUM', () => {
      expect(getBorderWidth(TokenSize.MEDIUM, 0.05)).toBeCloseTo(0.05);
    });

    it('should scale border width with square root of token scale', () => {
      const base = 0.05;
      const largeScale = 2;
      expect(getBorderWidth(TokenSize.LARGE, base)).toBeCloseTo(base * Math.sqrt(largeScale));

      const tinyScale = 0.5;
      expect(getBorderWidth(TokenSize.TINY, base)).toBeCloseTo(base * Math.sqrt(tinyScale));
    });

    it('should use default baseBorderWidth of 0.05', () => {
      expect(getBorderWidth(TokenSize.MEDIUM)).toBeCloseTo(0.05);
    });
  });

  describe('getNameplateOffset', () => {
    it('should return half height plus padding for MEDIUM', () => {
      const offset = getNameplateOffset(TokenSize.MEDIUM, GRID_SIZE);
      // height = 100, half = 50, padding = 100 * 0.1 = 10. Total 60.
      expect(offset).toBe(60);
    });

    it('should return correct offset for LARGE', () => {
      const offset = getNameplateOffset(TokenSize.LARGE, GRID_SIZE);
      // height = 200, half = 100, padding = 10. Total 110.
      expect(offset).toBe(110);
    });

    it('should return correct offset for TINY', () => {
      const offset = getNameplateOffset(TokenSize.TINY, GRID_SIZE);
      // height = 50, half = 25, padding = 10. Total 35.
      expect(offset).toBe(35);
    });
  });
});
