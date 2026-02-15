/**
 * Vision Calculations Utilities
 *
 * Utilities for calculating vision ranges, light levels, and line-of-sight
 * for Foundry VTT token vision system.
 *
 * @module utils/vision-calculations
 */

import {
  calculateDistance,
  isLineBlocked,
  isPointInVisionCone,
} from './geometry';
import {
  type LightLevel,
  getEffectiveLightLevel,
} from './lighting-utils';

import type { VisionBlocker } from '@/types/scene';
import type { Token, TokenVisionConfig } from '@/types/token';

export type { LightLevel };

// ===========================
// Vision Range Calculations
// ===========================

/**
 * Calculate the effective vision radius for a token
 *
 * Takes into account the token's vision configuration and returns
 * the maximum vision range in feet.
 *
 * @param token - The token to calculate vision for
 * @returns Vision radius in feet
 *
 * @example
 * ```ts
 * const range = calculateVisionRadius(token);
 * console.log(`Token can see ${range} feet`);
 * ```
 */
export function calculateVisionRadius(token: Token): number {
  if (!token.vision.enabled) {
    return 0;
  }

  const vision = token.vision;
  let maxRange = vision.range || 0;

  // Check special vision types and use the maximum
  if (vision.truesight) {
    maxRange = Math.max(maxRange, vision.truesight);
  }
  if (vision.blindsight) {
    maxRange = Math.max(maxRange, vision.blindsight);
  }
  if (vision.tremorsense) {
    maxRange = Math.max(maxRange, vision.tremorsense);
  }
  if (vision.darkvision) {
    maxRange = Math.max(maxRange, vision.darkvision);
  }

  return maxRange;
}

/**
 * Get the active vision type for a token based on light level
 *
 * @param token - The token to check
 * @param lightLevel - The current light level at the token's position
 * @returns The active vision mode
 */
export function getActiveVisionType(
  token: Token,
  lightLevel: LightLevel
): TokenVisionConfig['visionMode'] {
  const vision = token.vision;

  // Truesight works everywhere
  if (vision.truesight && vision.truesight > 0) {
    return 'truesight';
  }

  // Blindsight works everywhere
  if (vision.blindsight && vision.blindsight > 0) {
    return 'blindsight';
  }

  // Tremorsense for ground-based detection
  if (vision.tremorsense && vision.tremorsense > 0) {
    return 'tremorsense';
  }

  // Darkvision in dim/dark light
  if (lightLevel === 'dim' || lightLevel === 'dark') {
    if (vision.darkvision && vision.darkvision > 0) {
      return 'darkvision';
    }
  }

  return vision.visionMode || 'basic';
}

// ===========================
// Line of Sight Calculations
// ===========================

/**
 * Check if one token can see another token
 *
 * Takes into account vision ranges, vision types, light levels, and vision blockers.
 *
 * @param viewer - The token doing the viewing
 * @param target - The token being viewed
 * @param walls - Vision blocking elements
 * @param allTokens - All tokens for light calculations
 * @param globalLight - Whether scene has global light
 * @returns Whether the viewer can see the target
 *
 * @example
 * ```ts
 * const canSee = canSeeToken(playerToken, monsterToken, walls, allTokens);
 * if (canSee) {
 *   console.log('Monster is visible!');
 * }
 * ```
 */
export function canSeeToken(
  viewer: Token,
  target: Token,
  walls: VisionBlocker[] = [],
  allTokens: Token[] = [],
  globalLight: boolean = false
): boolean {
  // Check if viewer has vision enabled
  if (!viewer.vision.enabled) {
    return false;
  }

  // Calculate distance
  const distance = calculateDistance(
    { x: viewer.x, y: viewer.y },
    { x: target.x, y: target.y }
  );
  const distanceInFeet = distance / 20;

  // Get vision radius
  const visionRadius = calculateVisionRadius(viewer);
  if (visionRadius > 0 && distanceInFeet > visionRadius) {
    return false;
  }

  // Check vision cone/angle
  if (viewer.vision.angle < 360) {
    const isInCone = isPointInVisionCone(
      { x: viewer.x, y: viewer.y },
      viewer.rotation,
      viewer.vision.angle,
      { x: target.x, y: target.y }
    );
    if (!isInCone) {
      return false;
    }
  }

  // Blindsight and Truesight ignore darkness and some walls
  const visionType = viewer.vision.visionMode || 'basic';
  if (visionType === 'blindsight' || visionType === 'truesight') {
    // Check appropriate range
    const specialRange = visionType === 'truesight'
      ? viewer.vision.truesight || 0
      : viewer.vision.blindsight || 0;

    if (distanceInFeet <= specialRange) {
      // Only hard walls block these
      const hardWalls = walls.filter((w) => w.blocksLight && w.blocksMovement);
      return !isLineBlocked(
        { x: viewer.x, y: viewer.y },
        { x: target.x, y: target.y },
        hardWalls
      );
    }
  }

  // Tremorsense detects ground movement
  if (visionType === 'tremorsense' && viewer.vision.tremorsense) {
    if (distanceInFeet <= viewer.vision.tremorsense && target.elevation === viewer.elevation) {
      return true; // Tremorsense ignores walls
    }
  }

  // Check for vision blockers
  const lineBlocked = isLineBlocked(
    { x: viewer.x, y: viewer.y },
    { x: target.x, y: target.y },
    walls
  );

  if (lineBlocked) {
    return false;
  }

  // Check light level requirements
  const lightLevel = getEffectiveLightLevel(
    { x: target.x, y: target.y },
    allTokens,
    globalLight
  );

  // Normal vision requires light
  if (visionType === 'basic' && lightLevel === 'dark') {
    return false;
  }

  // Darkvision treats darkness as dim light
  if (visionType === 'darkvision') {
    const darkvisionRange = viewer.vision.darkvision || 0;
    if (lightLevel === 'dark' && distanceInFeet > darkvisionRange) {
      return false;
    }
  }

  return true;
}

// ===========================
// Vision Color Utilities
// ===========================

/**
 * Get the color for a vision type
 *
 * @param visionMode - The vision mode
 * @returns Hex color string
 */
export function getVisionColor(visionMode: TokenVisionConfig['visionMode']): string {
  const colors: Record<NonNullable<TokenVisionConfig['visionMode']>, string> = {
    basic: '#ffffff',
    darkvision: '#6366f1', // indigo/blue
    monochrome: '#9ca3af', // gray
    tremorsense: '#92400e', // brown
    blindsight: '#fbbf24', // yellow
    truesight: '#fbbf24', // gold
  };

  return colors[visionMode || 'basic'];
}

/**
 * Get opacity for vision type
 *
 * @param visionMode - The vision mode
 * @returns Opacity value 0-1
 */
export function getVisionOpacity(visionMode: TokenVisionConfig['visionMode']): number {
  const opacities: Record<NonNullable<TokenVisionConfig['visionMode']>, number> = {
    basic: 0.15,
    darkvision: 0.2,
    monochrome: 0.2,
    tremorsense: 0.25,
    blindsight: 0.3,
    truesight: 0.35,
  };

  return opacities[visionMode || 'basic'];
}
