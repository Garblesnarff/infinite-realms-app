import { describe, it, expect } from 'vitest';

import {
  getConePoints,
  getSpherePoints,
  getCubePoints,
  getLinePoints,
  FEET_PER_GRID_SQUARE
} from '../point-generators';

describe('point-generators', () => {
  const GRID_SIZE = 100;
  const ORIGIN = { x: 500, y: 500 };

  describe('getConePoints', () => {
    it('should start with the origin point', () => {
      const points = getConePoints(ORIGIN, 90, 15, 90, GRID_SIZE);
      expect(points[0]).toEqual(ORIGIN);
    });

    it('should generate correct points for a 90-degree cone facing East (90)', () => {
      // 15ft = 3 squares = 300 pixels
      const points = getConePoints(ORIGIN, 90, 15, 90, GRID_SIZE);
      const distancePixels = (15 / FEET_PER_GRID_SQUARE) * GRID_SIZE;

      // East is direction 90, which is 0 radians in standard math (after -90 adjustment)
      // With 90 degree cone, edges are at -45 and +45 degrees
      const leftEdge = points[1];
      const rightEdge = points[points.length - 1];

      // Left edge: 500 + 300*cos(-45), 500 + 300*sin(-45)
      // cos(-45) = 0.707, sin(-45) = -0.707
      expect(leftEdge.x).toBeCloseTo(ORIGIN.x + distancePixels * Math.cos(-Math.PI / 4));
      expect(leftEdge.y).toBeCloseTo(ORIGIN.y + distancePixels * Math.sin(-Math.PI / 4));

      // Right edge: 500 + 300*cos(45), 500 + 300*sin(45)
      expect(rightEdge.x).toBeCloseTo(ORIGIN.x + distancePixels * Math.cos(Math.PI / 4));
      expect(rightEdge.y).toBeCloseTo(ORIGIN.y + distancePixels * Math.sin(Math.PI / 4));
    });

    it('should handle different cone angles', () => {
      const points60 = getConePoints(ORIGIN, 90, 15, 60, GRID_SIZE);
      const points120 = getConePoints(ORIGIN, 90, 15, 120, GRID_SIZE);

      // Wider angle should have more points due to arcSteps calculation
      expect(points120.length).toBeGreaterThanOrEqual(points60.length);
    });
  });

  describe('getSpherePoints', () => {
    it('should generate a circular polygon', () => {
      const radius = 10; // 2 squares = 200 pixels
      const segments = 16;
      const points = getSpherePoints(ORIGIN, radius, GRID_SIZE, segments);

      expect(points).toHaveLength(segments);

      points.forEach(point => {
        const dist = Math.sqrt(
          Math.pow(point.x - ORIGIN.x, 2) + Math.pow(point.y - ORIGIN.y, 2)
        );
        expect(dist).toBeCloseTo(200);
      });
    });

    it('should respect the segments parameter', () => {
      const points = getSpherePoints(ORIGIN, 10, GRID_SIZE, 8);
      expect(points).toHaveLength(8);
    });
  });

  describe('getCubePoints', () => {
    it('should generate a square centered on the origin', () => {
      const size = 10; // 2 squares = 200 pixels
      const points = getCubePoints(ORIGIN, size, GRID_SIZE);

      expect(points).toHaveLength(4);
      // Square of 200x200 centered at 500,500 should have corners at 400,400 and 600,600
      expect(points).toContainEqual({ x: 400, y: 400 });
      expect(points).toContainEqual({ x: 600, y: 400 });
      expect(points).toContainEqual({ x: 600, y: 600 });
      expect(points).toContainEqual({ x: 400, y: 600 });
    });

    it('should handle rotation', () => {
      const size = 10;
      // Rotate 45 degrees
      const points = getCubePoints(ORIGIN, size, GRID_SIZE, 45);
      const dist = Math.sqrt(Math.pow(100, 2) + Math.pow(100, 2)); // distance to corner is 100*sqrt(2)

      // Top corner should now be at (500, 500 - dist)
      const topCorner = points.find(p => Math.abs(p.x - 500) < 0.1 && p.y < 500);
      expect(topCorner?.y).toBeCloseTo(500 - dist);
    });
  });

  describe('getLinePoints', () => {
    it('should generate a rectangle for a line', () => {
      // 20ft long, 10ft wide facing East (90)
      // length = 4 squares = 400px
      // width = 2 squares = 200px
      const points = getLinePoints(ORIGIN, 90, 20, 10, GRID_SIZE);

      expect(points).toHaveLength(4);

      // Facing East (standard math 0 rad)
      // Width is along Y axis (North-South)
      // Origin is at middle of one of the short ends.
      // So points should be:
      // (500, 400), (500, 600), (900, 600), (900, 400)

      expect(points).toContainEqual({ x: 500, y: 400 });
      expect(points).toContainEqual({ x: 500, y: 600 });
      expect(points).toContainEqual({ x: 900, y: 600 });
      expect(points).toContainEqual({ x: 900, y: 400 });
    });

    it('should generate correct points facing North (0)', () => {
      // 20ft long, 10ft wide facing North (0)
      // length = 400px, width = 200px
      // Direction 0 is -90 deg in standard math (Up)
      const points = getLinePoints(ORIGIN, 0, 20, 10, GRID_SIZE);

      // Width is along X axis (East-West)
      // Points should be:
      // (400, 500), (600, 500), (600, 100), (400, 100)
      expect(points).toContainEqual({ x: 400, y: 500 });
      expect(points).toContainEqual({ x: 600, y: 500 });
      expect(points).toContainEqual({ x: 600, y: 100 });
      expect(points).toContainEqual({ x: 400, y: 100 });
    });
  });
});
