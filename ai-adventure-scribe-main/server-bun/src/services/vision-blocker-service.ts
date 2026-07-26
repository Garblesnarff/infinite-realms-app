/* eslint-disable @typescript-eslint/no-explicit-any -- pre-existing violations, not introduced by the
   insert-select sweep that touched this file. lint-staged fails the commit on any
   error in a staged file, so converting one statement here would otherwise require
   an unrelated cleanup in the same change. Left for a dedicated pass. */
/**
 * Vision Blocker Service
 *
 * Manages vision-blocking shapes (walls, doors, windows, terrain) for scenes.
 * These shapes affect line of sight, movement, and lighting calculations.
 *
 * @module server/services/vision-blocker-service
 */

import { eq, and, asc, exists, sql } from 'drizzle-orm';

import { db } from '../../../db/client';
import {
  visionBlockingShapes,
  scenes,
  type VisionBlockingShape,
  type NewVisionBlockingShape,
} from '../../../db/schema/index';
import { InternalServerError, NotFoundError, ValidationError } from '../lib/errors.js';

/**
 * Input type for creating a vision blocker
 */
export interface CreateVisionBlockerData {
  sceneId: string;
  shapeType: 'wall' | 'door' | 'window' | 'terrain';
  pointsData: Array<{ x: number; y: number }>;
  blocksMovement?: boolean;
  blocksVision?: boolean;
  blocksLight?: boolean;
  isOneWay?: boolean;
  doorState?: 'open' | 'closed' | 'locked';
}

/**
 * Type for vision blocker updates
 */
export type UpdateVisionBlockerData = Partial<Omit<CreateVisionBlockerData, 'sceneId'>>;

export class VisionBlockerService {
  /**
   * List all vision blockers for a scene
   */
  static async listVisionBlockers(sceneId: string, userId: string): Promise<VisionBlockingShape[]> {
    const blockers = await db
      .select({ blockers: visionBlockingShapes })
      .from(visionBlockingShapes)
      .innerJoin(scenes, eq(visionBlockingShapes.sceneId, scenes.id))
      .where(and(eq(visionBlockingShapes.sceneId, sceneId), eq(scenes.userId, userId)))
      .orderBy(asc(visionBlockingShapes.createdAt));

    return blockers.map((b) => b.blockers);
  }

  /**
   * Get a single vision blocker by ID
   */
  static async getVisionBlocker(
    blockerId: string,
    userId: string,
  ): Promise<VisionBlockingShape | null> {
    const [result] = await db
      .select({ blocker: visionBlockingShapes })
      .from(visionBlockingShapes)
      .innerJoin(scenes, eq(visionBlockingShapes.sceneId, scenes.id))
      .where(and(eq(visionBlockingShapes.id, blockerId), eq(scenes.userId, userId)))
      .limit(1);

    return result?.blocker || null;
  }

  /**
   * Create a new vision blocker (GM only)
   */
  static async createVisionBlocker(
    sceneId: string,
    userId: string,
    data: Omit<CreateVisionBlockerData, 'sceneId'>,
  ): Promise<VisionBlockingShape> {
    // Validate points
    if (!data.pointsData || data.pointsData.length < 2) {
      throw new ValidationError('A vision blocker must have at least 2 points (a line segment)');
    }

    // Validate each point has x and y
    for (const point of data.pointsData) {
      if (typeof point.x !== 'number' || typeof point.y !== 'number') {
        throw new ValidationError('Each point must have numeric x and y coordinates');
      }
    }

    // Validate door state if shape is a door
    if (data.shapeType === 'door') {
      if (data.doorState && !['open', 'closed', 'locked'].includes(data.doorState)) {
        throw new ValidationError('Door state must be "open", "closed", or "locked"');
      }
    } else if (data.doorState) {
      // Non-door shapes shouldn't have door state
      throw new ValidationError(
        `Only doors can have a door state (shape type is ${data.shapeType})`,
      );
    }

    // Scene-ownership check split out of the insert. As an insert-select this
    // projected 9 of vision_blocking_shapes' 12 columns and Drizzle rejected it, so
    // no vision blocker was ever created.
    const owned = await db
      .select({ one: sql`1` })
      .from(scenes)
      .where(and(eq(scenes.id, sceneId), eq(scenes.userId, userId)))
      .limit(1);

    if (owned.length === 0) {
      throw new NotFoundError('Scene', sceneId);
    }

    const [blocker] = await db
      .insert(visionBlockingShapes)
      .values({
        sceneId,
        shapeType: data.shapeType,
        pointsData: data.pointsData,
        blocksMovement: data.blocksMovement ?? true,
        blocksVision: data.blocksVision ?? true,
        blocksLight: data.blocksLight ?? true,
        isOneWay: data.isOneWay ?? false,
        doorState: data.doorState ?? (data.shapeType === 'door' ? 'closed' : null),
        createdBy: userId,
      })
      .returning();

    if (!blocker) {
      throw new NotFoundError('Scene', sceneId);
    }

    return blocker;
  }

  /**
   * Update an existing vision blocker (GM only)
   */
  static async updateVisionBlocker(
    blockerId: string,
    userId: string,
    updates: UpdateVisionBlockerData,
  ): Promise<VisionBlockingShape> {
    // 🛡️ Sentinel: Get existing blocker (already checks scene ownership via join)
    const existingBlocker = await this.getVisionBlocker(blockerId, userId);
    if (!existingBlocker) {
      throw new NotFoundError('Vision blocker', blockerId);
    }

    // Validate points if provided
    if (updates.pointsData) {
      if (updates.pointsData.length < 2) {
        throw new ValidationError('A vision blocker must have at least 2 points');
      }

      for (const point of updates.pointsData) {
        if (typeof point.x !== 'number' || typeof point.y !== 'number') {
          throw new ValidationError('Each point must have numeric x and y coordinates');
        }
      }
    }

    // Validate door state
    if (updates.doorState) {
      const shapeType = updates.shapeType || existingBlocker.shapeType;
      if (shapeType !== 'door') {
        throw new ValidationError('Only doors can have a door state');
      }
      if (!['open', 'closed', 'locked'].includes(updates.doorState)) {
        throw new ValidationError('Door state must be "open", "closed", or "locked"');
      }
    }

    // 🛡️ Sentinel: Explicitly destructure to prevent Mass Assignment of sensitive fields
    const { id: _id, sceneId: _sceneId, createdBy: _createdBy, ...safeUpdates } = updates as any;

    // 🛡️ Sentinel: Incorporate ownership check directly into the update query (Defense in Depth)
    const [updated] = await db
      .update(visionBlockingShapes)
      .set({
        ...safeUpdates,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(visionBlockingShapes.id, blockerId),
          exists(
            db
              .select()
              .from(scenes)
              .where(and(eq(scenes.id, visionBlockingShapes.sceneId), eq(scenes.userId, userId))),
          ),
        ),
      )
      .returning();

    if (!updated) {
      throw new InternalServerError('Failed to update vision blocker');
    }

    return updated;
  }

  /**
   * Delete a vision blocker (GM only)
   */
  static async deleteVisionBlocker(blockerId: string, userId: string): Promise<boolean> {
    // 🛡️ Sentinel: Atomic delete with ownership check via exists subquery
    const result = await db
      .delete(visionBlockingShapes)
      .where(
        and(
          eq(visionBlockingShapes.id, blockerId),
          exists(
            db
              .select()
              .from(scenes)
              .where(and(eq(scenes.id, visionBlockingShapes.sceneId), eq(scenes.userId, userId))),
          ),
        ),
      )
      .returning({ id: visionBlockingShapes.id });

    return result.length > 0;
  }

  /**
   * Toggle a door's state between open/closed (GM only)
   * Locked doors cannot be toggled with this method - use updateVisionBlocker to unlock first
   */
  static async toggleDoor(blockerId: string, userId: string): Promise<VisionBlockingShape> {
    // 🛡️ Sentinel: Get existing blocker (already checks scene ownership)
    const existingBlocker = await this.getVisionBlocker(blockerId, userId);
    if (!existingBlocker) {
      throw new NotFoundError('Vision blocker', blockerId);
    }

    // Verify it's a door
    if (existingBlocker.shapeType !== 'door') {
      throw new ValidationError('Only doors can be toggled');
    }

    // Cannot toggle locked doors
    if (existingBlocker.doorState === 'locked') {
      throw new ValidationError('Cannot toggle a locked door - unlock it first');
    }

    // Toggle the door state
    const newState = existingBlocker.doorState === 'open' ? 'closed' : 'open';

    // 🛡️ Sentinel: Atomic update with ownership check (Defense in Depth)
    const [updated] = await db
      .update(visionBlockingShapes)
      .set({
        doorState: newState,
        // When a door opens, it typically stops blocking
        blocksMovement: newState === 'closed',
        blocksVision: newState === 'closed',
        blocksLight: newState === 'closed',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(visionBlockingShapes.id, blockerId),
          exists(
            db
              .select()
              .from(scenes)
              .where(and(eq(scenes.id, visionBlockingShapes.sceneId), eq(scenes.userId, userId))),
          ),
        ),
      )
      .returning();

    if (!updated) {
      throw new InternalServerError('Failed to toggle door');
    }

    return updated;
  }

  /**
   * Bulk create multiple vision blockers (GM only)
   * Useful for importing maps with pre-defined walls
   */
  static async bulkCreateBlockers(
    sceneId: string,
    userId: string,
    blockers: Array<Omit<CreateVisionBlockerData, 'sceneId'>>,
  ): Promise<VisionBlockingShape[]> {
    // 🛡️ Sentinel: Verify scene ownership once with existence masking
    const [sceneAccess] = await db
      .select({ id: scenes.id })
      .from(scenes)
      .where(and(eq(scenes.id, sceneId), eq(scenes.userId, userId)))
      .limit(1);

    if (!sceneAccess) {
      throw new NotFoundError('Scene', sceneId);
    }

    if (!blockers || blockers.length === 0) {
      return [];
    }

    // Validate all blockers
    for (let i = 0; i < blockers.length; i++) {
      const blocker = blockers[i];
      if (!blocker) continue;

      if (!blocker.pointsData || blocker.pointsData.length < 2) {
        throw new ValidationError(`Blocker at index ${i}: must have at least 2 points`);
      }

      for (const point of blocker.pointsData) {
        if (typeof point.x !== 'number' || typeof point.y !== 'number') {
          throw new ValidationError(`Blocker at index ${i}: each point must have numeric x and y`);
        }
      }

      // Validate door state
      if (blocker.shapeType === 'door') {
        if (blocker.doorState && !['open', 'closed', 'locked'].includes(blocker.doorState)) {
          throw new ValidationError(`Blocker at index ${i}: invalid door state`);
        }
      } else if (blocker.doorState) {
        throw new ValidationError(`Blocker at index ${i}: only doors can have a door state`);
      }
    }

    // Prepare values for bulk insert
    const values: NewVisionBlockingShape[] = blockers.map((blocker) => ({
      sceneId,
      shapeType: blocker.shapeType,
      pointsData: blocker.pointsData,
      blocksMovement: blocker.blocksMovement ?? true,
      blocksVision: blocker.blocksVision ?? true,
      blocksLight: blocker.blocksLight ?? true,
      isOneWay: blocker.isOneWay ?? false,
      doorState: blocker.doorState ?? (blocker.shapeType === 'door' ? 'closed' : null),
      createdBy: userId,
    }));

    const created = await db.insert(visionBlockingShapes).values(values).returning();

    return created;
  }

  /**
   * Get all doors in a scene (useful for quick door state checks)
   */
  static async listDoors(sceneId: string, userId: string): Promise<VisionBlockingShape[]> {
    const doors = await db
      .select({ blockers: visionBlockingShapes })
      .from(visionBlockingShapes)
      .innerJoin(scenes, eq(visionBlockingShapes.sceneId, scenes.id))
      .where(
        and(
          eq(visionBlockingShapes.sceneId, sceneId),
          eq(visionBlockingShapes.shapeType, 'door'),
          eq(scenes.userId, userId),
        ),
      )
      .orderBy(asc(visionBlockingShapes.createdAt));

    return doors.map((d) => d.blockers);
  }

  /**
   * Delete all vision blockers for a scene (GM only)
   * Useful when resetting a scene or clearing all walls
   */
  static async deleteAllBlockersForScene(sceneId: string, userId: string): Promise<number> {
    // 🛡️ Sentinel: Atomic bulk delete with ownership check
    const result = await db
      .delete(visionBlockingShapes)
      .where(
        and(
          eq(visionBlockingShapes.sceneId, sceneId),
          exists(
            db
              .select()
              .from(scenes)
              .where(and(eq(scenes.id, sceneId), eq(scenes.userId, userId))),
          ),
        ),
      )
      .returning({ id: visionBlockingShapes.id });

    return result.length;
  }
}
