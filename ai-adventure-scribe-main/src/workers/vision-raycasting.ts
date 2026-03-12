import type { Point2D, VisionBlocker } from '@/types/scene';

/**
 * Get all ray intersections
 */
export function getAllRayIntersections(
  origin: Point2D,
  walls: VisionBlocker[],
  maxRange: number,
): Array<{ point: Point2D; angle: number; distance: number }> {
  const endpoints: Array<{ point: Point2D; angle: number; distance: number }> = [];
  const uniqueAngles = new Set<number>();

  // Collect all wall vertices
  const wallVertices: Point2D[] = [];
  for (const wall of walls) {
    if (!wall.blocksLight) continue;
    for (const point of wall.points) {
      wallVertices.push(point);
    }
  }

  // Cast rays to each vertex with small angle offsets
  for (const vertex of wallVertices) {
    const dx = vertex.x - origin.x;
    const dy = vertex.y - origin.y;
    const angle = Math.atan2(dy, dx);

    const offsetAngles = [angle - 0.00001, angle, angle + 0.00001];

    for (const testAngle of offsetAngles) {
      const roundedAngle = Math.round(testAngle * 100000) / 100000;
      if (uniqueAngles.has(roundedAngle)) continue;
      uniqueAngles.add(roundedAngle);

      const direction = { x: Math.cos(testAngle), y: Math.sin(testAngle) };
      const intersection = raycastToWalls(origin, direction, walls, maxRange);

      if (intersection) {
        endpoints.push({
          point: intersection.point,
          angle: testAngle,
          distance: intersection.distance,
        });
      } else {
        endpoints.push({
          point: {
            x: origin.x + direction.x * maxRange,
            y: origin.y + direction.y * maxRange,
          },
          angle: testAngle,
          distance: maxRange,
        });
      }
    }
  }

  // If no walls, create circle
  if (endpoints.length === 0) {
    const numPoints = 32;
    for (let i = 0; i < numPoints; i++) {
      const angle = (i / numPoints) * Math.PI * 2 - Math.PI;
      const direction = { x: Math.cos(angle), y: Math.sin(angle) };
      endpoints.push({
        point: {
          x: origin.x + direction.x * maxRange,
          y: origin.y + direction.y * maxRange,
        },
        angle,
        distance: maxRange,
      });
    }
  }

  return endpoints;
}

/**
 * Raycast to walls
 */
export function raycastToWalls(
  origin: Point2D,
  direction: Point2D,
  walls: VisionBlocker[],
  maxDistance: number,
): { point: Point2D; distance: number } | null {
  let closestIntersection: { point: Point2D; distance: number } | null = null;
  let closestDistance = maxDistance;

  for (const wall of walls) {
    if (!wall.blocksLight) continue;

    for (let i = 0; i < wall.points.length - 1; i++) {
      const intersection = rayLineSegmentIntersection(
        origin,
        direction,
        wall.points[i],
        wall.points[i + 1],
      );

      if (intersection && intersection.distance < closestDistance) {
        closestDistance = intersection.distance;
        closestIntersection = intersection;
      }
    }

    if (wall.points.length > 2) {
      const intersection = rayLineSegmentIntersection(
        origin,
        direction,
        wall.points[wall.points.length - 1],
        wall.points[0],
      );

      if (intersection && intersection.distance < closestDistance) {
        closestDistance = intersection.distance;
        closestIntersection = intersection;
      }
    }
  }

  return closestIntersection;
}

/**
 * Ray-line segment intersection
 */
export function rayLineSegmentIntersection(
  origin: Point2D,
  direction: Point2D,
  segmentStart: Point2D,
  segmentEnd: Point2D,
): { point: Point2D; distance: number } | null {
  const dx = segmentEnd.x - segmentStart.x;
  const dy = segmentEnd.y - segmentStart.y;
  const det = dx * direction.y - dy * direction.x;

  if (Math.abs(det) < 1e-10) return null;

  const u =
    ((origin.y - segmentStart.y) * direction.x - (origin.x - segmentStart.x) * direction.y) / det;
  const t = ((origin.y - segmentStart.y) * dx - (origin.x - segmentStart.x) * dy) / det;

  if (u >= 0 && u <= 1 && t >= 0) {
    return {
      point: {
        x: origin.x + t * direction.x,
        y: origin.y + t * direction.y,
      },
      distance: t,
    };
  }

  return null;
}

/**
 * Clip polygon to cone
 */
export function clipPolygonToCone(
  points: Point2D[],
  origin: Point2D,
  rotation: number,
  angle: number,
  maxRange: number,
): Point2D[] {
  const clipped: Point2D[] = [];
  const halfAngle = (angle / 2) * (Math.PI / 180);
  const centerAngle = rotation * (Math.PI / 180);

  const startAngle = centerAngle - halfAngle;
  const endAngle = centerAngle + halfAngle;

  clipped.push({
    x: origin.x + Math.cos(startAngle) * maxRange,
    y: origin.y + Math.sin(startAngle) * maxRange,
  });

  for (const point of points) {
    if (isPointInVisionCone(origin, rotation, angle, point)) {
      clipped.push(point);
    }
  }

  clipped.push({
    x: origin.x + Math.cos(endAngle) * maxRange,
    y: origin.y + Math.sin(endAngle) * maxRange,
  });

  clipped.push(origin);

  return clipped;
}

/**
 * Check if point is in vision cone
 */
export function isPointInVisionCone(
  origin: Point2D,
  rotation: number,
  angle: number,
  target: Point2D,
): boolean {
  if (angle >= 360) return true;

  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const angleToTarget = Math.atan2(dy, dx) * (180 / Math.PI);

  const normalizedRotation = ((rotation % 360) + 360) % 360;
  const normalizedTargetAngle = ((angleToTarget % 360) + 360) % 360;

  let diff = Math.abs(normalizedTargetAngle - normalizedRotation);
  if (diff > 180) diff = 360 - diff;

  return diff <= angle / 2;
}
