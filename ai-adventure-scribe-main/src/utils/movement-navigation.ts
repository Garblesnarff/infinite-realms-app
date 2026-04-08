/**
 * Movement Navigation Utilities
 *
 * Provides pathfinding and reachable area calculations for tokens.
 *
 * @module utils/movement-navigation
 */

import type { Token } from '@/types/token';
import {
  GRID_SIZE_FEET,
  getMovementCost,
  isMovementBlocked,
  type GridCoordinate,
  type TerrainInfo,
  type Wall,
  type MovementMode,
  type MovementCapabilities,
} from './movement-validation';

// ===========================
// Reachable Squares Calculation
// ===========================

/**
 * Calculate all grid squares reachable with remaining movement
 * Uses flood-fill algorithm to find all valid destinations
 *
 * @param token - Token attempting to move
 * @param movementRemaining - Movement remaining in feet
 * @param walls - Array of walls that block movement
 * @param terrain - Terrain map
 * @param capabilities - Movement capabilities of the token
 * @returns Array of reachable grid coordinates
 */
export function calculateReachableSquares(
  token: Token,
  movementRemaining: number,
  walls: Wall[],
  terrain?: Map<string, TerrainInfo>,
  capabilities?: MovementCapabilities,
): GridCoordinate[] {
  const startX = Math.floor(token.x / GRID_SIZE_FEET);
  const startY = Math.floor(token.y / GRID_SIZE_FEET);
  const start: GridCoordinate = { x: startX, y: startY };

  const reachable: GridCoordinate[] = [];
  const visited = new Set<string>();
  const queue: Array<{ coord: GridCoordinate; costSoFar: number }> = [
    { coord: start, costSoFar: 0 },
  ];

  // Determine movement mode based on capabilities
  const canFly = (capabilities?.flySpeed ?? 0) > 0;
  const canSwim = (capabilities?.swimSpeed ?? 0) > 0;
  const canClimb = (capabilities?.climbSpeed ?? 0) > 0;

  while (queue.length > 0) {
    const current = queue.shift()!;
    const key = `${current.coord.x},${current.coord.y}`;

    if (visited.has(key)) continue;
    visited.add(key);

    // Add to reachable list
    if (current.costSoFar <= movementRemaining) {
      reachable.push(current.coord);
    }

    // Explore neighbors (8 directions)
    const neighbors: GridCoordinate[] = [
      { x: current.coord.x + 1, y: current.coord.y }, // Right
      { x: current.coord.x - 1, y: current.coord.y }, // Left
      { x: current.coord.x, y: current.coord.y + 1 }, // Down
      { x: current.coord.x, y: current.coord.y - 1 }, // Up
      { x: current.coord.x + 1, y: current.coord.y + 1 }, // Down-right
      { x: current.coord.x + 1, y: current.coord.y - 1 }, // Up-right
      { x: current.coord.x - 1, y: current.coord.y + 1 }, // Down-left
      { x: current.coord.x - 1, y: current.coord.y - 1 }, // Up-left
    ];

    for (const neighbor of neighbors) {
      const neighborKey = `${neighbor.x},${neighbor.y}`;
      if (visited.has(neighborKey)) continue;

      // Determine movement mode for this terrain
      const terrainInfo = terrain?.get(neighborKey);
      let mode: keyof MovementMode = 'walking';

      if (canFly && terrainInfo?.type !== 'impassable') {
        mode = 'flying';
      } else if (terrainInfo?.type === 'water' && canSwim) {
        mode = 'swimming';
      } else if (terrainInfo?.type === 'climbing' && canClimb) {
        mode = 'climbing';
      }

      // Calculate movement cost
      const moveCost = getMovementCost(current.coord, neighbor, terrain, mode);

      // Check if movement is blocked by walls
      if (isMovementBlocked(current.coord, neighbor, walls, mode)) {
        continue;
      }

      // Check if we have enough movement
      const totalCost = current.costSoFar + moveCost;
      if (totalCost <= movementRemaining) {
        queue.push({ coord: neighbor, costSoFar: totalCost });
      }
    }
  }

  return reachable;
}

// ===========================
// Path Calculation
// ===========================

/**
 * Calculate the shortest path between two grid coordinates
 * Uses A* pathfinding algorithm
 *
 * @param from - Starting grid coordinate
 * @param to - Ending grid coordinate
 * @param walls - Array of walls that block movement
 * @param terrain - Terrain map
 * @param capabilities - Movement capabilities
 * @returns Array of grid coordinates forming the path, or null if no path exists
 */
export function calculatePath(
  from: GridCoordinate,
  to: GridCoordinate,
  walls: Wall[],
  terrain?: Map<string, TerrainInfo>,
  capabilities?: MovementCapabilities,
): GridCoordinate[] | null {
  const openSet = new Set<string>([`${from.x},${from.y}`]);
  const cameFrom = new Map<string, GridCoordinate>();
  const gScore = new Map<string, number>();
  const fScore = new Map<string, number>();

  gScore.set(`${from.x},${from.y}`, 0);
  fScore.set(`${from.x},${from.y}`, heuristic(from, to));

  while (openSet.size > 0) {
    // Find node with lowest fScore
    let current: GridCoordinate | null = null;
    let currentKey = '';
    let lowestScore = Infinity;

    for (const key of openSet) {
      const score = fScore.get(key) ?? Infinity;
      if (score < lowestScore) {
        lowestScore = score;
        currentKey = key;
        const [x, y] = key.split(',').map(Number);
        current = { x, y };
      }
    }

    if (!current) break;

    // Check if we reached the goal
    if (current.x === to.x && current.y === to.y) {
      return reconstructPath(cameFrom, current);
    }

    openSet.delete(currentKey);

    // Explore neighbors
    const neighbors: GridCoordinate[] = [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
      { x: current.x + 1, y: current.y + 1 },
      { x: current.x + 1, y: current.y - 1 },
      { x: current.x - 1, y: current.y + 1 },
      { x: current.x - 1, y: current.y - 1 },
    ];

    for (const neighbor of neighbors) {
      const neighborKey = `${neighbor.x},${neighbor.y}`;

      // Check if movement is blocked
      if (isMovementBlocked(current, neighbor, walls)) {
        continue;
      }

      // Calculate tentative gScore
      const moveCost = getMovementCost(current, neighbor, terrain);
      const tentativeGScore = (gScore.get(currentKey) ?? Infinity) + moveCost;

      if (tentativeGScore < (gScore.get(neighborKey) ?? Infinity)) {
        cameFrom.set(neighborKey, current);
        gScore.set(neighborKey, tentativeGScore);
        fScore.set(neighborKey, tentativeGScore + heuristic(neighbor, to));

        if (!openSet.has(neighborKey)) {
          openSet.add(neighborKey);
        }
      }
    }
  }

  // No path found
  return null;
}

/**
 * Heuristic function for A* pathfinding (Manhattan distance)
 *
 * @param from - Starting coordinate
 * @param to - Ending coordinate
 * @returns Estimated cost
 */
function heuristic(from: GridCoordinate, to: GridCoordinate): number {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  return (dx + dy) * GRID_SIZE_FEET;
}

/**
 * Reconstruct path from A* cameFrom map
 *
 * @param cameFrom - Map of previous nodes
 * @param current - Current (goal) node
 * @returns Path as array of coordinates
 */
function reconstructPath(
  cameFrom: Map<string, GridCoordinate>,
  current: GridCoordinate,
): GridCoordinate[] {
  const path: GridCoordinate[] = [current];
  let currentKey = `${current.x},${current.y}`;

  while (cameFrom.has(currentKey)) {
    const prev = cameFrom.get(currentKey)!;
    path.unshift(prev);
    currentKey = `${prev.x},${prev.y}`;
  }

  return path;
}
