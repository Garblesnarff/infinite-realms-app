/**
 * Drawing Service
 *
 * Handles scene drawing operations using Drizzle ORM.
 * Provides methods for creating, retrieving, updating, and deleting drawings.
 * Includes authorization checks to ensure only authorized users can modify drawings.
 *
 * @module server/services/drawing-service
 */

import { eq, and, asc, or, inArray, exists } from 'drizzle-orm';

import { db } from '../../../db/client';
import {
  sceneDrawings,
  scenes,
  type SceneDrawing,
  type NewSceneDrawing,
} from '../../../db/schema/index';
import { InternalServerError, NotFoundError } from '../lib/errors.js';

/**
 * Data required to create a new drawing
 */
export interface CreateDrawingData {
  sceneId: string;
  drawingType: 'freehand' | 'line' | 'circle' | 'rectangle' | 'polygon' | 'text';
  pointsData: Array<{ x: number; y: number }>;
  strokeColor: string;
  strokeWidth: number;
  fillColor?: string | null;
  fillOpacity?: number;
  zIndex?: number;
  textContent?: string | null;
  fontSize?: number | null;
  fontFamily?: string | null;
}

export class DrawingService {
  /**
   * List all drawings for a specific scene
   */
  static async listDrawings(sceneId: string, userId: string): Promise<SceneDrawing[]> {
    const drawings = await db
      .select({ drawings: sceneDrawings })
      .from(sceneDrawings)
      .innerJoin(scenes, eq(sceneDrawings.sceneId, scenes.id))
      .where(
        and(
          eq(sceneDrawings.sceneId, sceneId),
          eq(scenes.userId, userId)
        )
      )
      .orderBy(asc(sceneDrawings.createdAt));

    return drawings.map(d => d.drawings);
  }

  /**
   * Create a new drawing on a scene
   */
  static async createDrawing(
    sceneId: string,
    userId: string,
    data: CreateDrawingData
  ): Promise<SceneDrawing> {
    // Verify scene ownership
    const [scene] = await db
      .select({ id: scenes.id })
      .from(scenes)
      .where(and(eq(scenes.id, sceneId), eq(scenes.userId, userId)))
      .limit(1);

    if (!scene) {
      throw new NotFoundError('Scene', sceneId);
    }

    // Create the drawing
    const [drawing] = await db
      .insert(sceneDrawings)
      .values({
        // Use verified sceneId parameter (not payload value) to prevent cross-scene writes.
        sceneId,
        createdBy: userId,
        drawingType: data.drawingType,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pointsData: data.pointsData as any,
        strokeColor: data.strokeColor,
        strokeWidth: data.strokeWidth,
        fillColor: data.fillColor ?? null,
        fillOpacity: data.fillOpacity ?? 0,
        zIndex: data.zIndex ?? 0,
        textContent: data.textContent ?? null,
        fontSize: data.fontSize ?? null,
        fontFamily: data.fontFamily ?? null,
      })
      .returning();

    if (!drawing) {
      throw new InternalServerError('Failed to create drawing');
    }

    return drawing;
  }

  /**
   * Update an existing drawing
   * Only the creator or scene owner can update
   */
  static async updateDrawing(
    drawingId: string,
    userId: string,
    updates: Partial<NewSceneDrawing>
  ): Promise<SceneDrawing | null> {
    // 🛡️ Sentinel: Atomic update with ownership check (creator OR scene owner)
    // We specifically omit internal/security fields from the update object
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { id: _id, sceneId: _sceneId, createdBy: _createdBy, ...safeUpdates } = updates as any;

    const [updated] = await db
      .update(sceneDrawings)
      .set({
        ...safeUpdates,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(sceneDrawings.id, drawingId),
          or(
            eq(sceneDrawings.createdBy, userId),
            exists(
              db.select()
                .from(scenes)
                .where(and(
                  eq(scenes.id, sceneDrawings.sceneId),
                  eq(scenes.userId, userId)
                ))
            )
          )
        )
      )
      .returning();

    return updated || null;
  }

  /**
   * Delete a drawing
   * Only the creator or scene owner can delete
   */
  static async deleteDrawing(drawingId: string, userId: string): Promise<boolean> {
    // 🛡️ Sentinel: Atomic delete with ownership check (creator OR scene owner)
    const result = await db
      .delete(sceneDrawings)
      .where(
        and(
          eq(sceneDrawings.id, drawingId),
          or(
            eq(sceneDrawings.createdBy, userId),
            exists(
              db.select()
                .from(scenes)
                .where(and(
                  eq(scenes.id, sceneDrawings.sceneId),
                  eq(scenes.userId, userId)
                ))
            )
          )
        )
      )
      .returning({ id: sceneDrawings.id });

    return result.length > 0;
  }

  /**
   * Bulk delete multiple drawings
   * Only scene owner can bulk delete
   */
  static async bulkDeleteDrawings(
    sceneId: string,
    drawingIds: string[],
    userId: string
  ): Promise<number> {
    if (drawingIds.length === 0) {
      return 0;
    }

    // Verify user is the scene owner
    const [scene] = await db
      .select({ id: scenes.id })
      .from(scenes)
      .where(and(eq(scenes.id, sceneId), eq(scenes.userId, userId)))
      .limit(1);

    if (!scene) {
      throw new NotFoundError('Scene', sceneId);
    }

    // Delete all specified drawings for this scene
    const result = await db
      .delete(sceneDrawings)
      .where(
        and(
          eq(sceneDrawings.sceneId, sceneId),
          inArray(sceneDrawings.id, drawingIds)
        )
      )
      .returning({ id: sceneDrawings.id });

    return result.length;
  }

  /**
   * Get a single drawing by ID
   */
  static async getDrawingById(drawingId: string, userId: string): Promise<SceneDrawing | null> {
    const [result] = await db
      .select({
        drawing: sceneDrawings,
      })
      .from(sceneDrawings)
      .innerJoin(scenes, eq(sceneDrawings.sceneId, scenes.id))
      .where(
        and(
          eq(sceneDrawings.id, drawingId),
          or(eq(sceneDrawings.createdBy, userId), eq(scenes.userId, userId))
        )
      )
      .limit(1);

    return result?.drawing || null;
  }
}
