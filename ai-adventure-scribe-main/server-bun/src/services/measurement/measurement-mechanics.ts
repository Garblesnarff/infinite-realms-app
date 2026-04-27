/**
 * Measurement Mechanics Logic
 *
 * Extracted from MeasurementService.
 * Handles pure geometry calculations for measurement templates (AoE).
 *
 * No database access - all logic is deterministic based on inputs.
 *
 * @module server/services/measurement/measurement-mechanics
 */

import type { MeasurementTemplate } from '../../../../db/schema/index';

export class MeasurementMechanics {
  /**
   * Check if a token is within a template's area
   */
  static isTokenInTemplate(
    template: MeasurementTemplate,
    token: any,
    parsedTemplate?: {
      originX: number;
      originY: number;
      distance: number;
      direction: number;
      width: number | null;
    }
  ): boolean {
    const tokenX = typeof token.positionX === 'number' ? token.positionX : parseFloat(String(token.positionX));
    const tokenY = typeof token.positionY === 'number' ? token.positionY : parseFloat(String(token.positionY));

    const originX = parsedTemplate?.originX ?? parseFloat(String(template.originX));
    const originY = parsedTemplate?.originY ?? parseFloat(String(template.originY));
    const distance = parsedTemplate?.distance ?? parseFloat(String(template.distance));
    const direction = parsedTemplate?.direction ?? parseFloat(String(template.direction));

    switch (template.templateType) {
      case 'sphere':
        return this.isInSphere(tokenX, tokenY, originX, originY, distance);

      case 'cube':
        return this.isInCube(tokenX, tokenY, originX, originY, distance);

      case 'cone':
        return this.isInCone(tokenX, tokenY, originX, originY, distance, direction);

      case 'cylinder':
        return this.isInCylinder(tokenX, tokenY, originX, originY, distance);

      case 'line':
      case 'ray': {
        const width = parsedTemplate?.width ?? (template.width ? parseFloat(String(template.width)) : 5);
        return this.isInLine(tokenX, tokenY, originX, originY, distance, direction, width ?? 5);
      }

      default:
        return false;
    }
  }

  /**
   * Check if point is within a sphere (circle in 2D)
   */
  static isInSphere(
    x: number,
    y: number,
    originX: number,
    originY: number,
    radius: number
  ): boolean {
    const dx = x - originX;
    const dy = y - originY;
    const distanceSquared = dx * dx + dy * dy;
    return distanceSquared <= radius * radius;
  }

  /**
   * Check if point is within a cube (square in 2D)
   */
  static isInCube(
    x: number,
    y: number,
    originX: number,
    originY: number,
    size: number
  ): boolean {
    const halfSize = size / 2;
    return (
      x >= originX - halfSize &&
      x <= originX + halfSize &&
      y >= originY - halfSize &&
      y <= originY + halfSize
    );
  }

  /**
   * Check if point is within a cone
   * Uses angle from origin and distance check
   */
  static isInCone(
    x: number,
    y: number,
    originX: number,
    originY: number,
    distance: number,
    direction: number,
    coneAngle: number = 90 // Default 90 degree cone
  ): boolean {
    const dx = x - originX;
    const dy = y - originY;
    const distanceToPoint = Math.sqrt(dx * dx + dy * dy);

    // Check if within distance
    if (distanceToPoint > distance) {
      return false;
    }

    // Calculate angle to point (in degrees)
    const angleToPoint = (Math.atan2(dy, dx) * 180) / Math.PI;

    // Normalize angles to 0-360
    const normalizedDirection = ((direction % 360) + 360) % 360;
    const normalizedAngle = ((angleToPoint % 360) + 360) % 360;

    // Calculate angle difference
    let angleDiff = Math.abs(normalizedAngle - normalizedDirection);
    if (angleDiff > 180) {
      angleDiff = 360 - angleDiff;
    }

    // Check if within cone angle
    return angleDiff <= coneAngle / 2;
  }

  /**
   * Check if point is within a cylinder (circle in 2D, same as sphere)
   */
  static isInCylinder(
    x: number,
    y: number,
    originX: number,
    originY: number,
    radius: number
  ): boolean {
    return this.isInSphere(x, y, originX, originY, radius);
  }

  /**
   * Check if point is within a line template
   * Calculates distance from point to line segment
   */
  static isInLine(
    x: number,
    y: number,
    originX: number,
    originY: number,
    length: number,
    direction: number,
    width: number
  ): boolean {
    // Calculate end point of line based on direction and length
    const radians = (direction * Math.PI) / 180;
    const endX = originX + length * Math.cos(radians);
    const endY = originY + length * Math.sin(radians);

    // Calculate distance from point to line segment
    const distance = this.distanceToLineSegment(x, y, originX, originY, endX, endY);

    // Check if within width/2 of the line
    return distance <= width / 2;
  }

  /**
   * Calculate distance from a point to a line segment
   */
  static distanceToLineSegment(
    px: number,
    py: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number
  ): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSquared = dx * dx + dy * dy;

    if (lengthSquared === 0) {
      // Line segment is a point
      const dpx = px - x1;
      const dpy = py - y1;
      return Math.sqrt(dpx * dpx + dpy * dpy);
    }

    // Calculate projection of point onto line segment
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared));

    // Calculate closest point on line segment
    const closestX = x1 + t * dx;
    const closestY = y1 + t * dy;

    // Calculate distance to closest point
    const distX = px - closestX;
    const distY = py - closestY;
    return Math.sqrt(distX * distX + distY * distY);
  }
}
