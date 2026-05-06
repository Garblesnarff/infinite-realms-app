/**
 * Lighting Integration with Line of Sight
 *
 * Integrates light sources with vision calculations to create realistic
 * lighting and shadow effects that respect walls and line-of-sight.
 *
 * @module utils/lighting-integration
 */

import { calculateShadows } from './lighting/mechanics';
import { raycastToWalls, isInShadow } from './raycasting';


import type { ShadowSegment } from './lighting/mechanics';
import type { QuadTree } from './spatial-partitioning';
import type { Point2D, VisionBlocker } from '@/types/scene';
import type { Token } from '@/types/token';

// ===========================
// Re-exports
// ===========================

export { calculateShadows, calculateAmbientOcclusion } from './lighting/mechanics';
export type { ShadowSegment } from './lighting/mechanics';

// ===========================
// Types
// ===========================

/**
 * Light polygon for rendering
 */
export interface LightPolygon {
  points: Point2D[];
  color: string;
  intensity: number;
  isBright: boolean; // true = bright light, false = dim light
}

/**
 * Combined lighting result
 */
export interface LightingResult {
  brightLightPolygons: LightPolygon[];
  dimLightPolygons: LightPolygon[];
  shadows: ShadowSegment[];
  ambientOcclusion?: number[]; // Grid of ambient occlusion values
}

// ===========================
// Light Polygon Calculation
// ===========================

/**
 * Calculate light polygon for a light source
 *
 * Similar to vision polygon but for light emission. Respects walls
 * and creates proper shadow boundaries.
 *
 * @param lightSource - Token emitting light
 * @param walls - Vision blocking walls
 * @param quadTree - Optional quadtree for performance
 * @returns Light polygons for bright and dim light
 *
 * @example
 * ```ts
 * const lighting = calculateLightPolygon(torch, walls);
 * // lighting.brightLightPolygons for bright light
 * // lighting.dimLightPolygons for dim light
 * ```
 */
export function calculateLightPolygon(
  lightSource: Token,
  walls: VisionBlocker[],
  quadTree?: QuadTree,
): { bright: LightPolygon | null; dim: LightPolygon | null } {
  if (!lightSource.light.emitsLight) {
    return { bright: null, dim: null };
  }

  const origin: Point2D = { x: lightSource.x, y: lightSource.y };
  const brightRange = lightSource.light.lightRange * 20; // Convert feet to pixels
  const dimRange = (lightSource.light.dimLightRange || 0) * 20;
  const totalRange = brightRange + dimRange;

  // Use quadtree if available for better performance
  const relevantWalls = quadTree ? quadTree.queryRadius(origin, totalRange) : walls;

  // Filter walls that block light
  const lightBlockingWalls = relevantWalls.filter((w) => w.blocksLight);

  // Calculate light polygon using raycasting
  const lightPolygonPoints = calculateLightRays(origin, lightBlockingWalls, totalRange);

  // Split into bright and dim regions
  const brightPolygon: LightPolygon | null =
    brightRange > 0
      ? {
          points: clipPolygonToRadius(lightPolygonPoints, origin, brightRange),
          color: lightSource.light.lightColor,
          intensity: lightSource.light.luminosity || 0.5,
          isBright: true,
        }
      : null;

  const dimPolygon: LightPolygon | null =
    dimRange > 0
      ? {
          points: subtractPolygons(
            clipPolygonToRadius(lightPolygonPoints, origin, totalRange),
            brightPolygon?.points || [],
          ),
          color: lightSource.light.lightColor,
          intensity: (lightSource.light.luminosity || 0.5) * 0.5,
          isBright: false,
        }
      : null;

  return { bright: brightPolygon, dim: dimPolygon };
}

/**
 * Calculate light rays from origin with wall blocking
 */
function calculateLightRays(origin: Point2D, walls: VisionBlocker[], maxRange: number): Point2D[] {
  const points: Point2D[] = [];
  const angles: number[] = [];

  // Collect angles to all wall vertices
  for (const wall of walls) {
    for (const point of wall.points) {
      const dx = point.x - origin.x;
      const dy = point.y - origin.y;
      const angle = Math.atan2(dy, dx);

      // Add small offsets to handle edge cases
      angles.push(angle - 0.00001, angle, angle + 0.00001);
    }
  }

  // If no walls, create a circle
  if (angles.length === 0) {
    const numPoints = 32;
    for (let i = 0; i < numPoints; i++) {
      const angle = (i / numPoints) * Math.PI * 2;
      angles.push(angle);
    }
  }

  // Cast rays at each angle
  for (const angle of angles) {
    const direction = {
      x: Math.cos(angle),
      y: Math.sin(angle),
    };

    const hit = raycastToWalls(origin, direction, walls, maxRange);

    if (hit) {
      points.push(hit.point);
    } else {
      points.push({
        x: origin.x + direction.x * maxRange,
        y: origin.y + direction.y * maxRange,
      });
    }
  }

  // Sort by angle
  return points.sort((a, b) => {
    const angleA = Math.atan2(a.y - origin.y, a.x - origin.x);
    const angleB = Math.atan2(b.y - origin.y, b.x - origin.x);
    return angleA - angleB;
  });
}

// ===========================
// Utility Functions
// ===========================

/**
 * Clip polygon to radius
 */
function clipPolygonToRadius(points: Point2D[], center: Point2D, radius: number): Point2D[] {
  return points.map((point) => {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance <= radius) {
      return point;
    }

    // Project point to radius
    return {
      x: center.x + (dx / distance) * radius,
      y: center.y + (dy / distance) * radius,
    };
  });
}

/**
 * Subtract one polygon from another (simplified)
 *
 * For dim light calculation, we need to subtract the bright light area from the total light area.
 * Since both are derived from the same raycast results but clipped to different radii,
 * we can create a "ring" polygon by combining both sets of points.
 */
function subtractPolygons(outer: Point2D[], inner: Point2D[]): Point2D[] {
  if (inner.length === 0) return outer;

  // To create a proper ring for rendering, we combine outer points and inner points in reverse
  // This creates a single polygon path that covers the area between the two radii
  return [...outer, ...[...inner].reverse()];
}

// ===========================
// Combined Lighting Calculation
// ===========================

/**
 * Calculate complete lighting for a scene
 *
 * Combines multiple light sources, vision, and shadows.
 *
 * @param tokens - All tokens (potential light sources)
 * @param walls - Vision/light blocking walls
 * @param quadTree - Optional quadtree for performance
 * @returns Complete lighting result
 */
export function calculateSceneLighting(
  tokens: Token[],
  walls: VisionBlocker[],
  quadTree?: QuadTree,
): LightingResult {
  const brightLightPolygons: LightPolygon[] = [];
  const dimLightPolygons: LightPolygon[] = [];
  const shadows: ShadowSegment[] = [];

  // Process each light source
  for (const token of tokens) {
    if (!token.light.emitsLight) continue;

    // Calculate light polygons
    const { bright, dim } = calculateLightPolygon(token, walls, quadTree);

    if (bright) brightLightPolygons.push(bright);
    if (dim) dimLightPolygons.push(dim);

    // Calculate shadows
    const tokenShadows = calculateShadows(token, walls);
    shadows.push(...tokenShadows);
  }

  return {
    brightLightPolygons,
    dimLightPolygons,
    shadows,
  };
}

/**
 * Check if a point is in light (for visibility calculations)
 *
 * @param point - Point to check
 * @param lightSources - Light emitting tokens
 * @param walls - Light blocking walls
 * @returns Whether point is illuminated
 */
export function isPointInLight(
  point: Point2D,
  lightSources: Token[],
  walls: VisionBlocker[],
): boolean {
  for (const source of lightSources) {
    if (!source.light.emitsLight) continue;

    const dx = point.x - source.x;
    const dy = point.y - source.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const distanceInFeet = distance / 20;

    const totalRange = source.light.lightRange + (source.light.dimLightRange || 0);

    if (distanceInFeet <= totalRange) {
      // Check if blocked by walls
      let blocked = false;
      for (const wall of walls) {
        if (isInShadow(point, { x: source.x, y: source.y }, wall)) {
          blocked = true;
          break;
        }
      }

      if (!blocked) {
        return true;
      }
    }
  }

  return false;
}
