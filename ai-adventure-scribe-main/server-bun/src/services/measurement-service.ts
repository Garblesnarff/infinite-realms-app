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
} from '../../../db/schema/index';
import { NotFoundError } from '../lib/errors.js';
import { MeasurementMechanics } from './measurement/measurement-mechanics.js';

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
      return MeasurementMechanics.isTokenInTemplate(template as any, token, parsedTemplate);
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
