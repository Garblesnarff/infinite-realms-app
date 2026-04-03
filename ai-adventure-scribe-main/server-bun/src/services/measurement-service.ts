/* eslint-disable max-lines */
/**
 * Measurement Service
 *
 * Handles measurement template operations (AoE templates for spells and abilities).
 * Provides methods for creating, deleting templates, calculating affected tokens,
 * and cleaning up temporary templates.
 *
 * Includes geometry calculations for different template types:
 * - Sphere: distance from origin
 * - Cube: bounding box check
 * - Cone: angle and distance check
 * - Cylinder: 2D circle check
 * - Line: distance from line segment
 *
 * @module server/services/measurement-service
 */

import { eq, and, lt, or, exists, isNotNull, sql } from 'drizzle-orm';

import { db } from '../../../db/client';
import {
  measurementTemplates,
  scenes,
  tokens,
  characters,
  type MeasurementTemplate,
  type Token,
} from '../../../db/schema/index';
import { NotFoundError } from '../lib/errors.js';

/**
 * Data required to create a new measurement template
 */
export interface CreateTemplateData {
  sceneId: string;
  templateType: 'cone' | 'cube' | 'sphere' | 'cylinder' | 'line' | 'ray';
  originX: number;
  originY: number;
  direction: number; // Degrees
  distance: number; // In feet
  width?: number; // For line templates
  color?: string;
  opacity?: number;
  isTemporary?: boolean;
}

/**
 * Result of affected tokens calculation
 */
export interface AffectedTokensResult {
  templateId: string;
  tokenIds: string[];
  tokens: Array<{
    id: string;
    name: string;
    positionX: number;
    positionY: number;
  }>;
}

export class MeasurementService {
  /**
   * Create a new measurement template
   */
  static async createTemplate(
    sceneId: string,
    userId: string,
    data: CreateTemplateData
  ): Promise<MeasurementTemplate> {
    // 🛡️ Sentinel: Incorporate ownership check into the INSERT query using SELECT for defense-in-depth.
    // This ensures that templates can only be added to scenes the user is authorized to access
    // while masking resource existence in a single atomic database round-trip.
    const [template] = await db
      .insert(measurementTemplates)
      .select(
        db
          .select({
            sceneId: sql`${sceneId}`,
            createdBy: sql`${userId}`,
            templateType: sql`${data.templateType}`,
            originX: sql`${data.originX}`,
            originY: sql`${data.originY}`,
            direction: sql`${data.direction}`,
            distance: sql`${data.distance}`,
            width: sql`${data.width ?? null}`,
            color: sql`${data.color ?? '#FF0000'}`,
            opacity: sql`${data.opacity ?? 0.5}`,
            isTemporary: sql`${data.isTemporary ?? true}`,
          })
          .from(scenes)
          .where(and(eq(scenes.id, sceneId), eq(scenes.userId, userId)))
      )
      .returning();

    if (!template) {
      // 🛡️ Sentinel: Throw NotFoundError for unauthorized access to mask resource existence.
      throw new NotFoundError('Scene', sceneId);
    }

    return template;
  }

  /**
   * Delete a measurement template
   * Only the creator or scene owner can delete
   */
  static async deleteTemplate(templateId: string, userId: string): Promise<boolean> {
    // 🛡️ Sentinel: Atomic delete with ownership check (creator OR scene owner)
    const result = await db
      .delete(measurementTemplates)
      .where(
        and(
          eq(measurementTemplates.id, templateId),
          or(
            eq(measurementTemplates.createdBy, userId),
            exists(
              db.select()
                .from(scenes)
                .where(and(
                  eq(scenes.id, measurementTemplates.sceneId),
                  eq(scenes.userId, userId)
                ))
            )
          )
        )
      )
      .returning({ id: measurementTemplates.id });

    return result.length > 0;
  }

  /**
   * Calculate which tokens are affected by a template
   * Uses geometry calculations based on template type
   */
  static async calculateAffectedTokens(
    templateId: string,
    userId: string
  ): Promise<AffectedTokensResult> {
    // ⚡ Bolt: Optimized template retrieval by selecting only the required columns
    // and using an innerJoin to verify scene ownership in a single round-trip.
    const [existing] = await db
      .select({
        template: {
          id: measurementTemplates.id,
          templateType: measurementTemplates.templateType,
          originX: measurementTemplates.originX,
          originY: measurementTemplates.originY,
          distance: measurementTemplates.distance,
          direction: measurementTemplates.direction,
          width: measurementTemplates.width,
          sceneId: measurementTemplates.sceneId,
        },
        sceneOwnerId: scenes.userId,
      })
      .from(measurementTemplates)
      .innerJoin(scenes, eq(measurementTemplates.sceneId, scenes.id))
      .where(
        and(
          eq(measurementTemplates.id, templateId),
          or(eq(measurementTemplates.createdBy, userId), eq(scenes.userId, userId))
        )
      )
      .limit(1);

    if (!existing) {
      throw new NotFoundError('Template', templateId);
    }

    const { template, sceneOwnerId } = existing;
    const isSceneOwner = sceneOwnerId === userId;

    // ⚡ Bolt: Pre-parse template values to avoid redundant parsing in the filter loop.
    const originX = parseFloat(String(template.originX));
    const originY = parseFloat(String(template.originY));
    const distance = parseFloat(String(template.distance));
    const direction = parseFloat(String(template.direction));
    const width = template.width ? parseFloat(String(template.width)) : null;

    // ⚡ Bolt: Added spatial bounding box check to the SQL query.
    // This reduces data transfer and in-memory processing by filtering out tokens
    // that are clearly outside the template's maximum range.
    const minX = originX - distance;
    const maxX = originX + distance;
    const minY = originY - distance;
    const maxY = originY + distance;

    // 🛡️ Sentinel: Get tokens in the same scene, respecting visibility for non-GMs.
    // ⚡ Bolt: Optimized query by selecting only required columns, using SQL casting (::float)
    // for coordinates, and joining the characters table only when necessary for non-owners.
    const tokensResult = await (db as any)
      .select({
        id: tokens.id,
        name: tokens.name,
        positionX: sql<number>`${tokens.positionX}::float`,
        positionY: sql<number>`${tokens.positionY}::float`,
        isVisible: tokens.isVisible,
        isHidden: tokens.isHidden,
        actorId: tokens.actorId,
        createdBy: tokens.createdBy,
      })
      .from(tokens)
      .leftJoin(
        characters,
        isSceneOwner ? sql`false` : eq(tokens.actorId, characters.id)
      )
      .where(
        and(
          eq(tokens.sceneId, template.sceneId),
          // ⚡ Bolt: Spatial bounding box filter (numeric cast handled by Drizzle/PG)
          sql`${tokens.positionX} BETWEEN ${minX} AND ${maxX}`,
          sql`${tokens.positionY} BETWEEN ${minY} AND ${maxY}`,
          isSceneOwner
            ? undefined
            : or(
                // Players can see visible tokens
                and(eq(tokens.isVisible, true), eq(tokens.isHidden, false)),
                // Players can always see tokens they created
                eq(tokens.createdBy, userId),
                // Players can always see their own characters' tokens
                and(
                  isNotNull(tokens.actorId),
                  or(eq(characters.userId, userId), eq(characters.ownerId, userId))
                )
              )
        )
      );

    const sceneTokens = tokensResult as any[];

    // Filter tokens based on template geometry
    // ⚡ Bolt: Pass pre-parsed template values for better performance
    const parsedTemplate = { originX, originY, distance, direction, width };

    const affectedTokens = sceneTokens.filter((token) => {
      return this.isTokenInTemplate(template as any, token, parsedTemplate);
    });

    return {
      templateId: template.id,
      tokenIds: affectedTokens.map((t) => t.id),
      tokens: affectedTokens.map((t) => ({
        id: t.id,
        name: t.name,
        positionX: t.positionX,
        positionY: t.positionY,
      })),
    };
  }

  /**
   * Check if a token is within a template's area
   */
  private static isTokenInTemplate(
    template: MeasurementTemplate,
    token: any,
    // ⚡ Bolt: Optional pre-parsed values to avoid redundant parsing
    parsedTemplate?: { originX: number; originY: number; distance: number; direction: number; width: number | null }
  ): boolean {
    // ⚡ Bolt: Use pre-parsed numeric coordinates from optimized query
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
  private static isInSphere(
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
  private static isInCube(
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
  private static isInCone(
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
  private static isInCylinder(
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
  private static isInLine(
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
  private static distanceToLineSegment(
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

  /**
   * Clean up old temporary templates
   * Deletes templates older than the specified age (default 1 hour)
   */
  static async cleanupTemporaryTemplates(
    sceneId: string,
    userId: string,
    maxAgeMinutes: number = 60
  ): Promise<number> {
    const cutoffDate = new Date(Date.now() - maxAgeMinutes * 60 * 1000);

    // 🛡️ Sentinel: Atomic delete with ownership check via exists subquery.
    // We removed the redundant pre-flight scene ownership query for performance
    // and to follow the atomic verification pattern.
    const result = await db
      .delete(measurementTemplates)
      .where(
        and(
          eq(measurementTemplates.sceneId, sceneId),
          eq(measurementTemplates.isTemporary, true),
          lt(measurementTemplates.createdAt, cutoffDate),
          exists(
            db
              .select()
              .from(scenes)
              .where(and(eq(scenes.id, measurementTemplates.sceneId), eq(scenes.userId, userId)))
          )
        )
      )
      .returning({ id: measurementTemplates.id });

    return result.length;
  }

  /**
   * Get a single template by ID
   */
  static async getTemplateById(templateId: string, userId: string): Promise<MeasurementTemplate | null> {
    const [result] = await db
      .select({
        template: measurementTemplates,
      })
      .from(measurementTemplates)
      .innerJoin(scenes, eq(measurementTemplates.sceneId, scenes.id))
      .where(
        and(
          eq(measurementTemplates.id, templateId),
          or(
            eq(measurementTemplates.createdBy, userId),
            eq(scenes.userId, userId)
          )
        )
      )
      .limit(1);

    return result?.template || null;
  }

  /**
   * List all templates for a scene
   */
  static async listTemplates(sceneId: string, userId: string): Promise<MeasurementTemplate[]> {
    // Incorporate ownership check into the query itself to prevent existence leakage
    const result = await db
      .select({ template: measurementTemplates })
      .from(measurementTemplates)
      .innerJoin(scenes, eq(measurementTemplates.sceneId, scenes.id))
      .where(
        and(
          eq(measurementTemplates.sceneId, sceneId),
          eq(scenes.userId, userId)
        )
      );

    return result.map(r => r.template);
  }
}
