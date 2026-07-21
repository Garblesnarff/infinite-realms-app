import type { CullableObject } from './culling';

/**
 * Helper function to create a cullable object from token data
 *
 * @param token - Token data
 * @param gridSize - Grid size in world units
 * @returns Cullable object
 */
export function createCullableFromToken(
  token: {
    id: string;
    positionX: number;
    positionY: number;
    elevation?: number;
    sizeWidth?: number;
    sizeHeight?: number;
  },
  gridSize: number = 1,
): CullableObject {
  const width = (token.sizeWidth ?? 1) * gridSize;
  const height = (token.sizeHeight ?? 1) * gridSize;
  const radius = Math.max(width, height) / 2;

  return {
    id: token.id,
    position: {
      x: token.positionX,
      y: token.positionY,
      z: token.elevation ?? 0,
    },
    radius,
    boundingBox: {
      min: {
        x: token.positionX - width / 2,
        y: token.positionY - height / 2,
        z: (token.elevation ?? 0) - 0.1,
      },
      max: {
        x: token.positionX + width / 2,
        y: token.positionY + height / 2,
        z: (token.elevation ?? 0) + 0.1,
      },
    },
  };
}

/**
 * Helper function to create a cullable object from drawing data
 *
 * @param drawing - Drawing data
 * @returns Cullable object
 */
export function createCullableFromDrawing(drawing: {
  id: string;
  points: Array<{ x: number; y: number }>;
  strokeWidth?: number;
}): CullableObject {
  if (drawing.points.length === 0) {
    return {
      id: drawing.id,
      position: { x: 0, y: 0, z: 0 },
      radius: 0,
    };
  }

  // Calculate bounding box from points
  let minX = drawing.points[0].x;
  let minY = drawing.points[0].y;
  let maxX = drawing.points[0].x;
  let maxY = drawing.points[0].y;

  for (const point of drawing.points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  // Add stroke width to bounding box
  const strokePadding = (drawing.strokeWidth ?? 1) / 2;
  minX -= strokePadding;
  minY -= strokePadding;
  maxX += strokePadding;
  maxY += strokePadding;

  // Calculate center and radius
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const width = maxX - minX;
  const height = maxY - minY;
  const radius = Math.sqrt(width * width + height * height) / 2;

  return {
    id: drawing.id,
    position: { x: centerX, y: centerY, z: 0 },
    radius,
    boundingBox: {
      min: { x: minX, y: minY, z: -0.1 },
      max: { x: maxX, y: maxY, z: 0.1 },
    },
  };
}
