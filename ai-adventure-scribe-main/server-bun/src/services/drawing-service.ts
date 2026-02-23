/**
 * Drawing Service
 *
 * Handles scene drawing operations using Drizzle ORM.
 * Provides methods for creating, retrieving, updating, and deleting drawings.
 * Includes authorization checks to ensure only authorized users can modify drawings.
 *
 * @module server/services/drawing-service
 */

import { eq, and, asc, or, inArray, exists, sql } from 'drizzle-orm';

import { db } from '../../../db/client';
import {
  sceneDrawings,
  scenes,
  type SceneDrawing,
  type NewSceneDrawing,
} from '../../../db/schema/index';
import { NotFoundError } from '../lib/errors.js';

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
      .where(and(eq(sceneDrawings.sceneId, sceneId), eq(scenes.userId, userId)))
      .orderBy(asc(sceneDrawings.createdAt));

    return drawings.map((d) => d.drawings);
  }

  /**
   * Create a new drawing on a scene
   */
  static async createDrawing(
    sceneId: string,
    userId: string,
    data: CreateDrawingData,
  ): Promise<SceneDrawing> {
    // ⚡ Bolt: Optimized to use a single atomic INSERT ... SELECT query for ownership verification.
    // This reduces database round-trips from 2 to 1 and prevents cross-scene unauthorized writes.
    const [drawing] = await db
      .insert(sceneDrawings)
      .select(
        db
          .select({
            sceneId: sql`${sceneId}`,
            createdBy: sql`${userId}`,
            drawingType: sql`${data.drawingType}`,
            // Use JSON.stringify for complex pointsData array to ensure correct JSONB casting
            pointsData: sql`${JSON.stringify(data.pointsData)}::jsonb`,
            strokeColor: sql`${data.strokeColor}`,
            strokeWidth: sql`${data.strokeWidth}`,
            fillColor: sql`${data.fillColor ?? null}`,
            fillOpacity: sql`${data.fillOpacity ?? 0}`,
            zIndex: sql`${data.zIndex ?? 0}`,
            textContent: sql`${data.textContent ?? null}`,
            fontSize: sql`${data.fontSize ?? null}`,
            fontFamily: sql`${data.fontFamily ?? null}`,
          })
          .from(scenes)
          .where(and(eq(scenes.id, sceneId), eq(scenes.userId, userId))),
      )
      .returning();

    if (!drawing) {
      // If no row was inserted, it means the SELECT returned zero rows (unauthorized or scene not found)
      throw new NotFoundError('Scene', sceneId);
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
    updates: Partial<NewSceneDrawing>,
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
              db
                .select()
                .from(scenes)
                .where(and(eq(scenes.id, sceneDrawings.sceneId), eq(scenes.userId, userId))),
            ),
          ),
        ),
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
              db
                .select()
                .from(scenes)
                .where(and(eq(scenes.id, sceneDrawings.sceneId), eq(scenes.userId, userId))),
            ),
          ),
        ),
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
    userId: string,
  ): Promise<number> {
    if (drawingIds.length === 0) {
      return 0;
    }

    // ⚡ Bolt: Optimized to use an atomic DELETE with an EXISTS subquery for ownership verification.
    // This reduces database round-trips from 2 to 1 and ensures the user owns the scene.
    const result = await db
      .delete(sceneDrawings)
      .where(
        and(
          eq(sceneDrawings.sceneId, sceneId),
          inArray(sceneDrawings.id, drawingIds),
          exists(
            db
              .select()
              .from(scenes)
              .where(and(eq(scenes.id, sceneId), eq(scenes.userId, userId))),
          ),
        ),
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
          or(eq(sceneDrawings.createdBy, userId), eq(scenes.userId, userId)),
        ),
      )
      .limit(1);

    return result?.drawing || null;
  }
}
