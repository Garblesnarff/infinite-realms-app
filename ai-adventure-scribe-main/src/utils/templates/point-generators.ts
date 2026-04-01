/**
 * Template Point Generators
 *
 * Extracted from template-calculations.ts.
 * Provides functions for generating polygon points for different D&D 5e area of effect templates.
 */

import type { Point2D } from '@/types/scene';

export const FEET_PER_GRID_SQUARE = 5; // D&D 5e standard

/**
 * Calculates the polygon points for a cone template
 * @param origin - Cone origin point in pixels
 * @param direction - Direction in degrees (0 = north/up)
 * @param distance - Cone distance in feet
 * @param angle - Cone angle in degrees (default 90)
 * @param gridSize - Grid size in pixels
 * @returns Polygon points defining the cone
 */
export function getConePoints(
  origin: Point2D,
  direction: number,
  distance: number,
  angle: number = 90,
  gridSize: number,
): Point2D[] {
  const distancePixels = (distance / FEET_PER_GRID_SQUARE) * gridSize;
  const halfAngle = (angle / 2) * (Math.PI / 180);
  const directionRad = (direction - 90) * (Math.PI / 180); // Convert to standard math angle

  // Calculate the two edge rays of the cone
  const leftAngle = directionRad - halfAngle;
  const rightAngle = directionRad + halfAngle;

  const points: Point2D[] = [origin];

  // Create arc points at the end of the cone
  const arcSteps = Math.max(8, Math.ceil(angle / 15)); // More steps for wider cones
  for (let i = 0; i <= arcSteps; i++) {
    const t = i / arcSteps;
    const currentAngle = leftAngle + (rightAngle - leftAngle) * t;
    points.push({
      x: origin.x + Math.cos(currentAngle) * distancePixels,
      y: origin.y + Math.sin(currentAngle) * distancePixels,
    });
  }

  return points;
}

/**
 * Calculates the points for a circular template
 */
export function getSpherePoints(
  origin: Point2D,
  radius: number,
  gridSize: number,
  segments: number = 32,
): Point2D[] {
  const radiusPixels = (radius / FEET_PER_GRID_SQUARE) * gridSize;
  const points: Point2D[] = [];

  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * 2 * Math.PI;
    points.push({
      x: origin.x + Math.cos(angle) * radiusPixels,
      y: origin.y + Math.sin(angle) * radiusPixels,
    });
  }

  return points;
}

/**
 * Calculates the points for a cube/square template
 */
export function getCubePoints(
  origin: Point2D,
  size: number,
  gridSize: number,
  rotation: number = 0,
): Point2D[] {
  const sizePixels = (size / FEET_PER_GRID_SQUARE) * gridSize;
  const halfSize = sizePixels / 2;

  // Create square centered on origin
  const corners: Point2D[] = [
    { x: -halfSize, y: -halfSize },
    { x: halfSize, y: -halfSize },
    { x: halfSize, y: halfSize },
    { x: -halfSize, y: halfSize },
  ];

  // Apply rotation and translation
  const rotationRad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rotationRad);
  const sin = Math.sin(rotationRad);

  return corners.map((corner) => ({
    x: origin.x + corner.x * cos - corner.y * sin,
    y: origin.y + corner.x * sin + corner.y * cos,
  }));
}

/**
 * Calculates the points for a line template
 */
export function getLinePoints(
  origin: Point2D,
  direction: number,
  length: number,
  width: number,
  gridSize: number,
): Point2D[] {
  const lengthPixels = (length / FEET_PER_GRID_SQUARE) * gridSize;
  const widthPixels = (width / FEET_PER_GRID_SQUARE) * gridSize;
  const halfWidth = widthPixels / 2;

  const directionRad = (direction - 90) * (Math.PI / 180);
  const cos = Math.cos(directionRad);
  const sin = Math.sin(directionRad);

  // Calculate perpendicular direction for width
  const perpCos = Math.cos(directionRad + Math.PI / 2);
  const perpSin = Math.sin(directionRad + Math.PI / 2);

  // Create rectangle for the line
  return [
    {
      x: origin.x - perpCos * halfWidth,
      y: origin.y - perpSin * halfWidth,
    },
    {
      x: origin.x + perpCos * halfWidth,
      y: origin.y + perpSin * halfWidth,
    },
    {
      x: origin.x + cos * lengthPixels + perpCos * halfWidth,
      y: origin.y + sin * lengthPixels + perpSin * halfWidth,
    },
    {
      x: origin.x + cos * lengthPixels - perpCos * halfWidth,
      y: origin.y + sin * lengthPixels - perpSin * halfWidth,
    },
  ];
}
