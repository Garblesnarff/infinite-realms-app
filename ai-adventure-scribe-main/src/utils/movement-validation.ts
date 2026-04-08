/**
 * Movement Validation Utilities
 *
 * Provides functions for validating token movement based on D&D 5e rules.
 * Handles difficult terrain, flying, climbing, swimming, and movement costs.
 *
 * @module utils/movement-validation
 */

import type { Token } from '@/types/token';

// ===========================
// Types
// ===========================

export interface GridCoordinate {
  x: number;
  y: number;
}

export interface TerrainInfo {
  type: 'normal' | 'difficult' | 'impassable' | 'water' | 'climbing';
  cost: number; // Movement cost multiplier (1 = normal, 2 = difficult, Infinity = impassable)
}

export interface Wall {
  from: GridCoordinate;
  to: GridCoordinate;
  blocks: 'movement' | 'sight' | 'both';
}

export interface MovementMode {
  walking: boolean;
  flying: boolean;
  swimming: boolean;
  climbing: boolean;
  burrowing: boolean;
}

export interface MovementCapabilities {
  speed: number; // Base walking speed in feet
  flySpeed?: number; // Flying speed in feet
  swimSpeed?: number; // Swimming speed in feet
  climbSpeed?: number; // Climbing speed in feet
  burrowSpeed?: number; // Burrowing speed in feet
  hover?: boolean; // Can hover (ignores falling)
}

// ===========================
// Constants
// ===========================

export const GRID_SIZE_FEET = 5; // Each grid square is 5 feet
const DIAGONAL_COST = 1.5; // D&D 5e diagonal movement cost (alternating 5/10 ft, averaged)

// ===========================
// Movement Cost Calculation
// ===========================

/**
 * Calculate the movement cost to move from one grid position to another
 *
 * @param from - Starting grid coordinate
 * @param to - Ending grid coordinate
 * @param terrain - Terrain map (optional)
 * @param mode - Movement mode (walking, flying, etc.)
 * @returns Movement cost in feet
 */
export function getMovementCost(
  from: GridCoordinate,
  to: GridCoordinate,
  terrain?: Map<string, TerrainInfo>,
  mode: keyof MovementMode = 'walking',
): number {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);

  // Calculate base distance (diagonal movement)
  const isDiagonal = dx > 0 && dy > 0;
  const gridDistance = Math.max(dx, dy);
  const baseCost = isDiagonal ? gridDistance * DIAGONAL_COST : gridDistance;
  const feetCost = baseCost * GRID_SIZE_FEET;

  // Get terrain at destination
  const terrainKey = `${to.x},${to.y}`;
  const terrainInfo = terrain?.get(terrainKey);

  // Flying ignores ground terrain (unless landing)
  if (mode === 'flying' && terrainInfo?.type !== 'impassable') {
    return feetCost;
  }

  // Burrowing ignores most terrain
  if (mode === 'burrowing') {
    return feetCost;
  }

  // Apply terrain cost multiplier
  const terrainMultiplier = terrainInfo?.cost ?? 1;

  // Difficult terrain: double cost
  if (terrainInfo?.type === 'difficult') {
    return feetCost * 2;
  }

  // Water terrain: half speed if no swim speed
  if (terrainInfo?.type === 'water' && mode !== 'swimming') {
    return feetCost * 2;
  }

  // Climbing: half speed if no climb speed
  if (terrainInfo?.type === 'climbing' && mode !== 'climbing') {
    return feetCost * 2;
  }

  return feetCost * terrainMultiplier;
}

/**
 * Check if movement between two grid positions is blocked by walls
 *
 * @param from - Starting grid coordinate
 * @param to - Ending grid coordinate
 * @param walls - Array of wall segments
 * @param mode - Movement mode (flying can ignore some walls)
 * @returns True if movement is blocked
 */
export function isMovementBlocked(
  from: GridCoordinate,
  to: GridCoordinate,
  walls: Wall[],
  mode: keyof MovementMode = 'walking',
): boolean {
  // Flying can potentially move over some walls
  if (mode === 'flying') {
    return false; // Simplified: flying ignores walls
  }

  // Check if any wall blocks the movement path
  for (const wall of walls) {
    if (wall.blocks === 'sight') continue; // Only sight walls don't block movement

    // Check if the movement path intersects the wall
    if (linesIntersect(from, to, wall.from, wall.to)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if two line segments intersect
 *
 * @param a1 - First point of line A
 * @param a2 - Second point of line A
 * @param b1 - First point of line B
 * @param b2 - Second point of line B
 * @returns True if lines intersect
 */
function linesIntersect(
  a1: GridCoordinate,
  a2: GridCoordinate,
  b1: GridCoordinate,
  b2: GridCoordinate,
): boolean {
  const det = (a2.x - a1.x) * (b2.y - b1.y) - (b2.x - b1.x) * (a2.y - a1.y);
  if (det === 0) return false; // Parallel lines

  const lambda = ((b2.y - b1.y) * (b2.x - a1.x) + (b1.x - b2.x) * (b2.y - a1.y)) / det;
  const gamma = ((a1.y - a2.y) * (b2.x - a1.x) + (a2.x - a1.x) * (b2.y - a1.y)) / det;

  // Use inclusive check for wall boundaries (gamma) to prevent moving through corners.
  // Use inclusive check for destination (lambda <= 1) to prevent landing on a wall.
  // Use exclusive check for start point (lambda > 0) to allow moving away if already on a wall.
  return lambda > 0 && lambda <= 1 && gamma >= 0 && gamma <= 1;
}

/**
 * Get movement capabilities from a token
 *
 * @param token - Token to extract capabilities from
 * @returns Movement capabilities
 */
export function getMovementCapabilities(token: Token): MovementCapabilities {
  // Extract from token data or character sheet
  // This is a simplified version - would need to integrate with character data
  return {
    speed: 30, // Default walking speed
    flySpeed: token.flags?.flySpeed,
    swimSpeed: token.flags?.swimSpeed,
    climbSpeed: token.flags?.climbSpeed,
    burrowSpeed: token.flags?.burrowSpeed,
    hover: token.flags?.hover,
  };
}

// ===========================
// Utility Functions
// ===========================

/**
 * Convert pixel coordinates to grid coordinates
 *
 * @param pixelX - X coordinate in pixels
 * @param pixelY - Y coordinate in pixels
 * @param gridSize - Grid size in pixels
 * @returns Grid coordinate
 */
export function pixelToGrid(pixelX: number, pixelY: number, gridSize: number): GridCoordinate {
  return {
    x: Math.floor(pixelX / gridSize),
    y: Math.floor(pixelY / gridSize),
  };
}

/**
 * Convert grid coordinates to pixel coordinates (center of square)
 *
 * @param gridX - Grid X coordinate
 * @param gridY - Grid Y coordinate
 * @param gridSize - Grid size in pixels
 * @returns Pixel coordinates
 */
export function gridToPixel(
  gridX: number,
  gridY: number,
  gridSize: number,
): { x: number; y: number } {
  return {
    x: (gridX + 0.5) * gridSize,
    y: (gridY + 0.5) * gridSize,
  };
}

/**
 * Calculate distance between two grid coordinates in feet
 *
 * @param from - Starting coordinate
 * @param to - Ending coordinate
 * @returns Distance in feet
 */
export function gridDistance(from: GridCoordinate, to: GridCoordinate): number {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  const gridDist = Math.max(dx, dy);
  return gridDist * GRID_SIZE_FEET;
}
