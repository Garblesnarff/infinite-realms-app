/**
 * Lighting Calculation Utilities
 *
 * Utilities for calculating light levels and light reach for tokens
 * in the battle map system. Extracted from vision-calculations.ts.
 *
 * @module utils/lighting-utils
 */

import { calculateDistance, isLineBlocked } from './geometry';

import type { Point2D, VisionBlocker } from '@/types/scene';
import type { Token } from '@/types/token';

/**
 * Light level at a position
 */
export type LightLevel = 'bright' | 'dim' | 'dark';

/**
 * Calculate the effective light level at a position based on nearby light sources
 *
 * @param position - The position to check
 * @param tokens - All tokens in the scene (potential light sources)
 * @param globalLight - Whether the scene has global illumination
 * @returns The light level at the position
 *
 * @example
 * ```ts
 * const lightLevel = getEffectiveLightLevel(
 *   { x: 100, y: 200 },
 *   allTokens,
 *   false
 * );
 * ```
 */
export function getEffectiveLightLevel(
  position: Point2D,
  tokens: Token[],
  globalLight: boolean = false
): LightLevel {
  // If global light is enabled, everything is bright
  if (globalLight) {
    return 'bright';
  }

  let brightestLevel: LightLevel = 'dark';

  // Check each token for light emission
  for (const token of tokens) {
    if (!token.light.emitsLight) {
      continue;
    }

    const distance = calculateDistance(
      { x: token.x, y: token.y },
      position
    );

    // Convert pixels to feet (assuming standard 5ft grid = 100px)
    const distanceInFeet = distance / 20; // 100px / 5ft = 20px per foot

    // Check bright light range
    const brightRange = token.light.lightRange || 0;
    if (distanceInFeet <= brightRange) {
      return 'bright'; // Bright light takes precedence
    }

    // Check dim light range
    const dimRange = token.light.dimLightRange || 0;
    if (distanceInFeet <= brightRange + dimRange) {
      if (brightestLevel === 'dark') {
        brightestLevel = 'dim';
      }
    }
  }

  return brightestLevel;
}

/**
 * Calculate if light from a source reaches a position
 *
 * @param lightSource - The token emitting light
 * @param target - The target position
 * @param walls - Vision blockers that might block light
 * @returns Object containing whether light reaches and at what level
 */
export function calculateLightReach(
  lightSource: Token,
  target: Point2D,
  walls: VisionBlocker[] = []
): { reaches: boolean; level: LightLevel; distance: number } {
  if (!lightSource.light.emitsLight) {
    return { reaches: false, level: 'dark', distance: 0 };
  }

  const distance = calculateDistance(
    { x: lightSource.x, y: lightSource.y },
    target
  );
  const distanceInFeet = distance / 20;

  const brightRange = lightSource.light.lightRange || 0;
  const dimRange = lightSource.light.dimLightRange || 0;
  const totalRange = brightRange + dimRange;

  // Check if within range
  if (distanceInFeet > totalRange) {
    return { reaches: false, level: 'dark', distance: distanceInFeet };
  }

  // Check if blocked by walls
  const isBlocked = isLineBlocked(
    { x: lightSource.x, y: lightSource.y },
    target,
    walls
  );

  if (isBlocked) {
    return { reaches: false, level: 'dark', distance: distanceInFeet };
  }

  // Determine light level
  const level: LightLevel = distanceInFeet <= brightRange ? 'bright' : 'dim';

  return { reaches: true, level, distance: distanceInFeet };
}

/**
 * Calculate combined light level from multiple sources
 *
 * Bright light always takes precedence. Multiple dim lights don't combine to bright.
 *
 * @param lightLevels - Array of light levels at a position
 * @returns The combined light level
 */
export function stackLightLevels(lightLevels: LightLevel[]): LightLevel {
  if (lightLevels.includes('bright')) {
    return 'bright';
  }
  if (lightLevels.includes('dim')) {
    return 'dim';
  }
  return 'dark';
}

/**
 * Get all light sources affecting a position
 *
 * @param position - The position to check
 * @param tokens - All tokens in the scene
 * @param walls - Vision blockers
 * @returns Array of light source data
 */
export function getLightSourcesAtPosition(
  position: Point2D,
  tokens: Token[],
  walls: VisionBlocker[] = []
): Array<{
  token: Token;
  level: LightLevel;
  distance: number;
}> {
  const sources: Array<{
    token: Token;
    level: LightLevel;
    distance: number;
  }> = [];

  for (const token of tokens) {
    const result = calculateLightReach(token, position, walls);
    if (result.reaches) {
      sources.push({
        token,
        level: result.level,
        distance: result.distance,
      });
    }
  }

  return sources;
}
