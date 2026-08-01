/**
 * Template Token Filters
 *
 * Extracted from template-calculations.ts.
 * Handles filtering tokens affected by area of effect templates (cone, sphere, cube, line).
 */

import { calculateDistance } from './distance-utils';
import { getConePoints, getCubePoints, getLinePoints } from './point-generators';

import type { Point2D } from '@/types/scene';
import type { Token } from '@/types/token';

import { isPointInPolygon } from '@/utils/polygon-utils';

/**
 * Gets tokens within a cone template
 */
export function getTokensInCone(
  origin: Point2D,
  direction: number,
  angle: number,
  distance: number,
  tokens: Token[],
  gridSize: number,
): Token[] {
  const conePoints = getConePoints(origin, direction, distance, angle, gridSize);
  return tokens.filter((token) => {
    const tokenCenter = { x: token.x + gridSize / 2, y: token.y + gridSize / 2 };
    return isPointInPolygon(tokenCenter, conePoints);
  });
}

/**
 * Gets tokens within a sphere/circle template
 */
export function getTokensInSphere(
  origin: Point2D,
  radius: number,
  tokens: Token[],
  gridSize: number,
  useGridDistance: boolean = true,
): Token[] {
  return tokens.filter((token) => {
    const tokenCenter = { x: token.x + gridSize / 2, y: token.y + gridSize / 2 };
    const distance = calculateDistance(origin, tokenCenter, gridSize, useGridDistance);
    return distance <= radius;
  });
}

/**
 * Gets tokens within a cube/square template
 */
export function getTokensInCube(
  origin: Point2D,
  size: number,
  tokens: Token[],
  gridSize: number,
  rotation: number = 0,
): Token[] {
  const cubePoints = getCubePoints(origin, size, gridSize, rotation);
  return tokens.filter((token) => {
    const tokenCenter = { x: token.x + gridSize / 2, y: token.y + gridSize / 2 };
    return isPointInPolygon(tokenCenter, cubePoints);
  });
}

/**
 * Gets tokens within a line template
 */
export function getTokensInLine(
  origin: Point2D,
  direction: number,
  width: number,
  length: number,
  tokens: Token[],
  gridSize: number,
): Token[] {
  const linePoints = getLinePoints(origin, direction, length, width, gridSize);
  return tokens.filter((token) => {
    const tokenCenter = { x: token.x + gridSize / 2, y: token.y + gridSize / 2 };
    return isPointInPolygon(tokenCenter, linePoints);
  });
}
