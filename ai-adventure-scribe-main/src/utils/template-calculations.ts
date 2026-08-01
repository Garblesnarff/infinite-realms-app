/**
 * Template Calculations Utilities
 *
 * This module provides mathematical utilities for calculating areas of effect,
 * determining affected tokens, and managing measurement templates on the battle map.
 */


import { calculateDistance } from './templates/distance-utils';

import type { MeasurementTemplate } from '@/types/drawing';
import type { Point2D } from '@/types/scene';

import { TemplateType } from '@/types/drawing';
import { GridType } from '@/types/scene';
import { isPointInPolygon } from '@/utils/polygon-utils';
import {
  FEET_PER_GRID_SQUARE,
  getConePoints,
  getSpherePoints,
  getCubePoints,
  getLinePoints,
} from '@/utils/templates/point-generators';

export { isPointInPolygon, FEET_PER_GRID_SQUARE, getConePoints, getSpherePoints, getCubePoints, getLinePoints };

// ===========================
// Types
// ===========================

export interface TemplateGeometry {
  points: Point2D[]; // Polygon points defining the template boundary
  gridSquares: Point2D[]; // Grid coordinates of affected squares
}

export interface MeasurementSegment {
  from: Point2D;
  to: Point2D;
  distance: number; // Distance in feet
}

export interface MeasurementPath {
  waypoints: Point2D[];
  segments: MeasurementSegment[];
  totalDistance: number;
}

export {
  euclideanDistance,
  gridDistance,
  calculateDistance,
} from './templates/distance-utils';

/**
 * Calculates a measurement path with waypoints
 */
export function calculateMeasurementPath(
  waypoints: Point2D[],
  gridSize: number,
  useGridDistance: boolean = true,
): MeasurementPath {
  const segments: MeasurementSegment[] = [];
  let totalDistance = 0;

  for (let i = 0; i < waypoints.length - 1; i++) {
    const from = waypoints[i];
    const to = waypoints[i + 1];
    const distance = calculateDistance(from, to, gridSize, useGridDistance);

    segments.push({ from, to, distance });
    totalDistance += distance;
  }

  return { waypoints, segments, totalDistance };
}

export {
  getTokensInCone,
  getTokensInSphere,
  getTokensInCube,
  getTokensInLine,
} from './templates/token-filters';

// ===========================
// Grid Square Calculations
// ===========================

/**
 * Gets grid squares affected by a template
 */
export function getAffectedGridSquares(
  template: MeasurementTemplate,
  gridSize: number,
  gridType: GridType = GridType.SQUARE,
): Point2D[] {
  if (gridType !== GridType.SQUARE) {
    // TODO: Implement hexagonal grid support
    return [];
  }

  let points: Point2D[] = [];

  // Get template geometry
  switch (template.templateType) {
    case TemplateType.CONE:
      points = getConePoints(
        { x: template.x, y: template.y },
        template.direction,
        template.distance,
        template.angle || 90,
        gridSize,
      );
      break;

    case TemplateType.SPHERE:
    case TemplateType.CYLINDER:
      points = getSpherePoints({ x: template.x, y: template.y }, template.distance, gridSize);
      break;

    case TemplateType.CUBE:
      points = getCubePoints(
        { x: template.x, y: template.y },
        template.distance,
        gridSize,
        template.direction,
      );
      break;

    case TemplateType.LINE:
    case TemplateType.RAY:
      points = getLinePoints(
        { x: template.x, y: template.y },
        template.direction,
        template.distance,
        template.width || 5,
        gridSize,
      );
      break;
  }

  // Find bounding box
  const minX = Math.min(...points.map((p) => p.x));
  const maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const maxY = Math.max(...points.map((p) => p.y));

  // Check each grid square in the bounding box
  const affectedSquares: Point2D[] = [];
  for (let x = Math.floor(minX / gridSize); x <= Math.ceil(maxX / gridSize); x++) {
    for (let y = Math.floor(minY / gridSize); y <= Math.ceil(maxY / gridSize); y++) {
      const squareCenter = {
        x: x * gridSize + gridSize / 2,
        y: y * gridSize + gridSize / 2,
      };

      // Include square if its center is within the template
      if (isPointInPolygon(squareCenter, points)) {
        affectedSquares.push({ x, y });
      }
    }
  }

  return affectedSquares;
}

// ===========================
// Geometry Utilities
// ===========================

/**
 * Snaps a point to the nearest grid intersection
 */
export function snapToGridIntersection(point: Point2D, gridSize: number): Point2D {
  return {
    x: Math.round(point.x / gridSize) * gridSize,
    y: Math.round(point.y / gridSize) * gridSize,
  };
}

/**
 * Snaps a point to the center of the nearest grid square
 */
export function snapToGridCenter(point: Point2D, gridSize: number): Point2D {
  return {
    x: Math.floor(point.x / gridSize) * gridSize + gridSize / 2,
    y: Math.floor(point.y / gridSize) * gridSize + gridSize / 2,
  };
}

/**
 * Snaps an angle to the nearest 45-degree increment
 */
export function snapAngleTo45Degrees(angle: number): number {
  return Math.round(angle / 45) * 45;
}

// ===========================
// Movement Range Colors
// ===========================

export interface MovementRangeColors {
  normal: string; // Green
  dash: string; // Yellow
  beyond: string; // Red
}

export const defaultMovementColors: MovementRangeColors = {
  normal: '#00ff00',
  dash: '#ffff00',
  beyond: '#ff0000',
};

/**
 * Gets the color for a movement distance based on movement speed
 * @param distance - Distance in feet
 * @param speed - Movement speed in feet
 * @returns Hex color string
 */
export function getMovementRangeColor(
  distance: number,
  speed: number,
  colors: MovementRangeColors = defaultMovementColors,
): string {
  if (distance <= speed) {
    return colors.normal;
  } else if (distance <= speed * 2) {
    return colors.dash;
  } else {
    return colors.beyond;
  }
}
