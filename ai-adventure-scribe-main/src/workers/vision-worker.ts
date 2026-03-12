/**
 * Vision Calculation Web Worker
 *
 * Offloads heavy vision polygon calculations to a separate thread
 * to prevent blocking the main UI thread. Handles multiple tokens
 * and caches results when tokens don't move.
 *
 * @module workers/vision-worker
 */

import type { Point2D, VisionBlocker } from '@/types/scene';
import type { Token } from '@/types/token';
import type { VisionPolygon } from '@/utils/vision-polygon';

import {
  getAllRayIntersections,
  clipPolygonToCone,
} from '@/workers/vision-raycasting';

// ===========================
// Message Types
// ===========================

/**
 * Message types for worker communication
 */
export type VisionWorkerMessage =
  | {
      type: 'CALCULATE_VISION';
      payload: {
        token: Token;
        walls: VisionBlocker[];
        range?: number;
      };
      requestId: string;
    }
  | {
      type: 'CALCULATE_MULTI_VISION';
      payload: {
        tokens: Token[];
        walls: VisionBlocker[];
        range?: number;
      };
      requestId: string;
    }
  | {
      type: 'UPDATE_WALLS';
      payload: {
        walls: VisionBlocker[];
      };
    }
  | {
      type: 'CLEAR_CACHE';
    };

/**
 * Response from worker
 */
export type VisionWorkerResponse =
  | {
      type: 'VISION_RESULT';
      payload: {
        tokenId: string;
        polygon: VisionPolygon;
      };
      requestId: string;
    }
  | {
      type: 'MULTI_VISION_RESULT';
      payload: {
        polygons: Map<string, VisionPolygon>;
      };
      requestId: string;
    }
  | {
      type: 'ERROR';
      payload: {
        error: string;
      };
      requestId: string;
    };

// ===========================
// Vision Cache
// ===========================

/**
 * Cache entry for vision polygon
 */
interface CacheEntry {
  polygon: VisionPolygon;
  tokenPosition: Point2D;
  tokenRotation: number;
  visionRange: number;
  timestamp: number;
}

/**
 * Vision calculation cache
 */
class VisionCache {
  private cache = new Map<string, CacheEntry>();
  private readonly maxAge = 5000; // 5 seconds
  private readonly maxEntries = 100;

  /**
   * Get cached polygon if token hasn't moved
   */
  get(token: Token, range?: number): VisionPolygon | null {
    const entry = this.cache.get(token.id);
    if (!entry) return null;

    const now = Date.now();
    if (now - entry.timestamp > this.maxAge) {
      this.cache.delete(token.id);
      return null;
    }

    // Check if token position/rotation changed
    const effectiveRange = range !== undefined ? range : token.vision.range;
    if (
      entry.tokenPosition.x !== token.x ||
      entry.tokenPosition.y !== token.y ||
      entry.tokenRotation !== token.rotation ||
      entry.visionRange !== effectiveRange
    ) {
      return null;
    }

    return entry.polygon;
  }

  /**
   * Store polygon in cache
   */
  set(token: Token, polygon: VisionPolygon, range?: number): void {
    // Limit cache size
    if (this.cache.size >= this.maxEntries) {
      // Remove oldest entry
      let oldestKey: string | null = null;
      let oldestTime = Infinity;

      for (const [key, entry] of this.cache.entries()) {
        if (entry.timestamp < oldestTime) {
          oldestTime = entry.timestamp;
          oldestKey = key;
        }
      }

      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    const effectiveRange = range !== undefined ? range : token.vision.range;

    this.cache.set(token.id, {
      polygon,
      tokenPosition: { x: token.x, y: token.y },
      tokenRotation: token.rotation,
      visionRange: effectiveRange,
      timestamp: Date.now(),
    });
  }

  /**
   * Clear entire cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Remove specific token from cache
   */
  remove(tokenId: string): void {
    this.cache.delete(tokenId);
  }
}

// ===========================
// Worker State
// ===========================

const cache = new VisionCache();
let walls: VisionBlocker[] = [];

// ===========================
// Worker Message Handler
// ===========================

/**
 * Handle incoming messages from main thread
 */
self.onmessage = (event: MessageEvent<VisionWorkerMessage>) => {
  const message = event.data;

  try {
    switch (message.type) {
      case 'CALCULATE_VISION':
        handleCalculateVision(message);
        break;

      case 'CALCULATE_MULTI_VISION':
        handleCalculateMultiVision(message);
        break;

      case 'UPDATE_WALLS':
        handleUpdateWalls(message);
        break;

      case 'CLEAR_CACHE':
        cache.clear();
        break;

      default:
        // @ts-ignore: Handle potential unknown message types at runtime
        throw new Error(`Unknown message type: ${(message as { type: string }).type}`);
    }
  } catch (error) {
    self.postMessage({
      type: 'ERROR',
      payload: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      requestId: 'requestId' in message ? message.requestId : 'unknown',
    } as VisionWorkerResponse);
  }
};

// ===========================
// Message Handlers
// ===========================

/**
 * Calculate vision for a single token
 */
function handleCalculateVision(
  message: Extract<VisionWorkerMessage, { type: 'CALCULATE_VISION' }>,
): void {
  const { token, walls: messageWalls, range } = message.payload;
  const effectiveWalls = messageWalls || walls;

  // Check cache first
  let polygon = cache.get(token, range);

  if (!polygon) {
    // Calculate new polygon
    polygon = calculateVisionPolygonInWorker(token, effectiveWalls, range);
    cache.set(token, polygon, range);
  }

  self.postMessage({
    type: 'VISION_RESULT',
    payload: {
      tokenId: token.id,
      polygon,
    },
    requestId: message.requestId,
  } as VisionWorkerResponse);
}

/**
 * Calculate vision for multiple tokens (parallel processing)
 */
function handleCalculateMultiVision(
  message: Extract<VisionWorkerMessage, { type: 'CALCULATE_MULTI_VISION' }>,
): void {
  const { tokens, walls: messageWalls, range } = message.payload;
  const effectiveWalls = messageWalls || walls;

  const polygons = new Map<string, VisionPolygon>();

  for (const token of tokens) {
    // Check cache first
    let polygon = cache.get(token, range);

    if (!polygon) {
      // Calculate new polygon
      polygon = calculateVisionPolygonInWorker(token, effectiveWalls, range);
      cache.set(token, polygon, range);
    }

    polygons.set(token.id, polygon);
  }

  // Note: Map cannot be directly serialized, convert to object
  const polygonsObj: Record<string, VisionPolygon> = {};
  for (const [key, value] of polygons) {
    polygonsObj[key] = value;
  }

  self.postMessage({
    type: 'MULTI_VISION_RESULT',
    payload: {
      polygons: polygonsObj,
    },
    requestId: message.requestId,
  } as unknown as VisionWorkerResponse); // Cast needed due to Map serialization
}

/**
 * Update stored walls and clear cache
 */
function handleUpdateWalls(message: Extract<VisionWorkerMessage, { type: 'UPDATE_WALLS' }>): void {
  walls = message.payload.walls;
  cache.clear(); // Wall changes invalidate all cached polygons
}

// ===========================
// Vision Calculation (Worker Implementation)
// ===========================

/**
 * Calculate vision polygon in worker context
 *
 * This is a standalone implementation that doesn't rely on external modules
 * to avoid module loading issues in Web Workers.
 */
function calculateVisionPolygonInWorker(
  token: Token,
  walls: VisionBlocker[],
  range?: number,
): VisionPolygon {
  if (!token.vision.enabled) {
    return {
      points: [],
      range: 0,
      visionMode: token.vision.visionMode || 'basic',
    };
  }

  // Calculate effective range
  const visionRange = range !== undefined ? range : calculateVisionRadius(token) * 20;
  const origin: Point2D = { x: token.x, y: token.y };

  // Filter walls based on vision type
  const effectiveWalls = filterWallsByVisionType(token, walls);

  // Get all ray intersections
  const endpoints = getAllRayIntersections(origin, effectiveWalls, visionRange);

  // Sort by angle
  const sortedEndpoints = endpoints.sort((a, b) => a.angle - b.angle);

  // Extract points
  let points = sortedEndpoints.map((ep) => ep.point);

  // Handle vision cone (limited angle)
  if (token.vision.angle < 360) {
    points = clipPolygonToCone(points, origin, token.rotation, token.vision.angle, visionRange);
  }

  // Remove duplicate points
  points = removeDuplicatePoints(points);

  // Ensure polygon is closed
  if (points.length > 0) {
    const first = points[0];
    const last = points[points.length - 1];
    const dx = first.x - last.x;
    const dy = first.y - last.y;
    if (Math.sqrt(dx * dx + dy * dy) > 0.1) {
      points.push(first);
    }
  }

  return {
    points,
    range: visionRange,
    visionMode: token.vision.visionMode || 'basic',
    coneAngle: token.vision.angle < 360 ? token.vision.angle : undefined,
    rotation: token.vision.angle < 360 ? token.rotation : undefined,
  };
}

/**
 * Calculate vision radius from token
 */
function calculateVisionRadius(token: Token): number {
  if (!token.vision.enabled) return 0;

  const vision = token.vision;
  let maxRange = vision.range || 0;

  if (vision.truesight) maxRange = Math.max(maxRange, vision.truesight);
  if (vision.blindsight) maxRange = Math.max(maxRange, vision.blindsight);
  if (vision.tremorsense) maxRange = Math.max(maxRange, vision.tremorsense);
  if (vision.darkvision) maxRange = Math.max(maxRange, vision.darkvision);

  return maxRange;
}

/**
 * Filter walls by vision type
 */
function filterWallsByVisionType(token: Token, walls: VisionBlocker[]): VisionBlocker[] {
  const visionType = token.vision.visionMode || 'basic';

  if (visionType === 'truesight' || visionType === 'blindsight') {
    return walls.filter((wall) => wall.blocksLight && wall.blocksMovement);
  }

  if (visionType === 'tremorsense') {
    return [];
  }

  return walls.filter((wall) => wall.blocksLight);
}


/**
 * Remove duplicate points
 */
function removeDuplicatePoints(points: Point2D[], tolerance: number = 0.1): Point2D[] {
  if (points.length === 0) return [];

  const unique: Point2D[] = [points[0]];

  for (let i = 1; i < points.length; i++) {
    const point = points[i];
    let isDuplicate = false;

    for (const existing of unique) {
      const dx = point.x - existing.x;
      const dy = point.y - existing.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < tolerance) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      unique.push(point);
    }
  }

  return unique;
}

// Export for TypeScript
export {};
