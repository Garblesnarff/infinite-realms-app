/**
 * Fog of War Service
 *
 * Manages user-specific fog of war revelation for scenes.
 * Each user has their own revealed areas per scene for exploration tracking.
 *
 * @module server/services/fog-of-war-service
 */

/* eslint-disable max-lines, @typescript-eslint/no-explicit-any */
import { randomUUID } from 'crypto';

import { and, eq, exists, or, sql, type SQL } from 'drizzle-orm';

import { db } from '../../../db/client';
import { characters, fogOfWar, scenes } from '../../../db/schema/index';
import { NotFoundError, ValidationError } from '../lib/errors.js';

import type { FogOfWar } from '../../../db/schema/index';

/**
 * Type for a revealed area polygon
 */
export interface RevealedArea {
  id: string;
  points: Array<{ x: number; y: number }>;
  revealedAt: string;
  revealedBy?: string;
  isPermanent: boolean;
}

/**
 * Input type for revealing a new area
 */
export interface RevealAreaInput {
  points: Array<{ x: number; y: number }>;
  revealedBy?: string;
  isPermanent?: boolean;
}

/**
 * Callback type for WebSocket broadcast
 */
export type BroadcastCallback = (message: unknown) => void;

export class FogOfWarService {
  /**
   * Internal helper to build authorization logic for both DM and players.
   * 🛡️ Sentinel: Centralized ownership verification to prevent IDOR and existence leakage.
   */
  private static getAccessConditions(
    sceneId: string,
    targetUserId: string,
    requesterId: string,
  ): SQL {
    return and(
      eq(scenes.id, sceneId),
      or(
        // Case 1: Requester is target and (is scene owner or is campaign participant)
        and(
          eq(sql`${targetUserId}`, requesterId),
          or(
            eq(scenes.userId, requesterId),
            exists(
              db
                .select()
                .from(characters)
                .where(
                  and(
                    eq(characters.campaignId, scenes.campaignId),
                    or(
                      eq(characters.userId, requesterId),
                      eq(characters.ownerId, requesterId),
                    ),
                  ),
                ),
            ),
          ),
        ),
        // Case 2: Requester is scene owner and target is campaign participant
        and(
          eq(scenes.userId, requesterId),
          exists(
            db
              .select()
              .from(characters)
              .where(
                and(
                  eq(characters.campaignId, scenes.campaignId),
                  or(
                    eq(characters.userId, targetUserId),
                    eq(characters.ownerId, targetUserId),
                  ),
                ),
              ),
          ),
        ),
      ),
    );
  }

  /**
   * Helper to build a subquery filter that verifies a requester has access to
   * manage fog of war for a target user in a specific scene.
   */
  private static getAccessFilter(
    sceneId: string,
    targetUserId: string,
    requesterId: string,
  ): any {
    return exists(
      db
        .select()
        .from(scenes)
        .where(this.getAccessConditions(sceneId, targetUserId, requesterId)),
    );
  }

  /**
   * Internal helper to verify scene access and target user permissions.
   * Throws NotFoundError if access is denied.
   */
  private static async verifyAccess(
    sceneId: string,
    targetUserId: string,
    requesterId: string,
  ): Promise<void> {
    const [result] = await db
      .select({ id: scenes.id })
      .from(scenes)
      .where(this.getAccessConditions(sceneId, targetUserId, requesterId))
      .limit(1);

    if (!result) {
      throw new NotFoundError('Scene', sceneId);
    }
  }

  /**
   * Get all revealed areas for a user in a specific scene
   */
  static async getRevealedAreas(
    sceneId: string,
    userId: string,
    requesterId: string
  ): Promise<RevealedArea[]> {
    // 🛡️ Sentinel: Combined verification and retrieval into a single query.
    // This reduces round-trips and ensures defense-in-depth even if pre-flight check fails.
    const fogRecord = await db.query.fogOfWar.findFirst({
      where: and(
        eq(fogOfWar.sceneId, sceneId),
        eq(fogOfWar.userId, userId),
        this.getAccessFilter(sceneId, userId, requesterId)
      ),
    });

    if (!fogRecord) {
      // 🛡️ Sentinel: If no record was found, we still need to verify access to maintain standard error behavior.
      // If unauthorized, verifyAccess will throw NotFoundError.
      await this.verifyAccess(sceneId, userId, requesterId);

      // No fog of war record yet - return empty array
      return [];
    }

    return fogRecord.revealedAreas as RevealedArea[];
  }

  /**
   * Reveal a new area on the map for a user
   * Creates a fog of war record if one doesn't exist
   */
  static async revealArea(
    sceneId: string,
    userId: string,
    requesterId: string,
    input: RevealAreaInput,
    broadcast?: BroadcastCallback
  ): Promise<RevealedArea> {
    // ⚡ Bolt: Refactored to delegate to revealAreas to ensure consistent atomic optimization
    // and reduce code duplication for validation and persistence logic.
    const areas = await this.revealAreas(sceneId, userId, requesterId, [input], broadcast);
    return areas[0];
  }

  /**
   * Reveal multiple areas at once (batch operation)
   * More efficient than calling revealArea multiple times
   */
  static async revealAreas(
    sceneId: string,
    userId: string,
    requesterId: string,
    inputs: RevealAreaInput[],
    broadcast?: BroadcastCallback
  ): Promise<RevealedArea[]> {
    if (inputs.length === 0) {
      return [];
    }

    const newAreas: RevealedArea[] = [];

    // Validate and create all areas
    for (const input of inputs) {
      // Validate points
      if (!input.points || input.points.length < 3) {
        throw new ValidationError('A polygon must have at least 3 points');
      }

      // Validate each point has x and y
      for (const point of input.points) {
        if (typeof point.x !== 'number' || typeof point.y !== 'number') {
          throw new ValidationError('Each point must have numeric x and y coordinates');
        }
      }

      newAreas.push({
        id: randomUUID(),
        points: input.points,
        revealedAt: new Date().toISOString(),
        revealedBy: input.revealedBy,
        isPermanent: input.isPermanent ?? true,
      });
    }

    // 🛡️ Sentinel: Refactored to use atomic UPSERT ... SELECT for ownership verification.
    // This ensures that fog of war can only be modified for authorized scenes/users in a single round-trip.
    // 🛡️ Sentinel (Fix): Incorporated specific sceneId filter into inner select to prevent unconstrained row insertion.
    const [upsertResult] = await db
      .insert(fogOfWar)
      .select(
        db
          .select({
            sceneId: sql`${sceneId}`,
            userId: sql`${userId}`,
            revealedAreas: sql`${JSON.stringify(newAreas)}::jsonb`,
            updatedAt: sql`NOW()`,
          })
          .from(scenes)
          .where(this.getAccessConditions(sceneId, userId, requesterId))
      )
      .onConflictDoUpdate({
        target: [fogOfWar.sceneId, fogOfWar.userId],
        set: {
          revealedAreas: sql`${fogOfWar.revealedAreas} || ${JSON.stringify(newAreas)}::jsonb`,
          updatedAt: new Date(),
        },
        where: this.getAccessFilter(fogOfWar.sceneId, fogOfWar.userId, requesterId)
      })
      .returning();

    if (!upsertResult) {
      // 🛡️ Sentinel: Throw NotFoundError for unauthorized access to mask resource existence.
      throw new NotFoundError('Scene', sceneId);
    }

    // Broadcast to WebSocket if callback provided
    if (broadcast) {
      broadcast({
        type: 'fog:reveal',
        sceneId,
        userId,
        timestamp: Date.now(),
        data: {
          areas: newAreas,
          userId,
        },
      });
    }

    return newAreas;
  }

  /**
   * Remove a specific revealed area by ID
   */
  static async concealArea(
    sceneId: string,
    userId: string,
    requesterId: string,
    areaId: string,
    broadcast?: BroadcastCallback
  ): Promise<boolean> {
    // 🛡️ Sentinel: Combined verification and retrieval into a single query.
    const existingRecord = await db.query.fogOfWar.findFirst({
      where: and(
        eq(fogOfWar.sceneId, sceneId),
        eq(fogOfWar.userId, userId),
        this.getAccessFilter(sceneId, userId, requesterId)
      ),
    });

    if (!existingRecord) {
      // 🛡️ Sentinel: If no record was found, we still need to verify access to maintain standard error behavior.
      await this.verifyAccess(sceneId, userId, requesterId);
      return false;
    }

    const currentAreas = existingRecord.revealedAreas as RevealedArea[];
    const concealedArea = currentAreas.find((area) => area.id === areaId);
    const filteredAreas = currentAreas.filter((area) => area.id !== areaId);

    if (filteredAreas.length === currentAreas.length) {
      // Area ID not found
      return false;
    }

    // 🛡️ Sentinel: Atomic update with ownership check for defense-in-depth.
    const [updated] = await db
      .update(fogOfWar)
      .set({
        revealedAreas: filteredAreas,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(fogOfWar.id, existingRecord.id),
          eq(fogOfWar.sceneId, sceneId),
          eq(fogOfWar.userId, userId),
          this.getAccessFilter(sceneId, userId, requesterId)
        )
      )
      .returning();

    if (!updated) {
      // Should rarely happen if fetch succeeded, but masks existence if it does.
      throw new NotFoundError('Scene', sceneId);
    }

    // Broadcast to WebSocket if callback provided
    if (broadcast && concealedArea) {
      broadcast({
        type: 'fog:conceal',
        sceneId,
        userId,
        timestamp: Date.now(),
        data: {
          areas: [concealedArea],
          userId,
        },
      });
    }

    return true;
  }

  /**
   * Remove multiple revealed areas by IDs (batch operation)
   */
  static async concealAreas(
    sceneId: string,
    userId: string,
    requesterId: string,
    areaIds: string[],
    broadcast?: BroadcastCallback
  ): Promise<RevealedArea[]> {
    if (areaIds.length === 0) {
      return [];
    }

    // 🛡️ Sentinel: Combined verification and retrieval into a single query.
    const existingRecord = await db.query.fogOfWar.findFirst({
      where: and(
        eq(fogOfWar.sceneId, sceneId),
        eq(fogOfWar.userId, userId),
        this.getAccessFilter(sceneId, userId, requesterId)
      ),
    });

    if (!existingRecord) {
      // 🛡️ Sentinel: If no record was found, we still need to verify access to maintain standard error behavior.
      await this.verifyAccess(sceneId, userId, requesterId);
      return [];
    }

    const currentAreas = existingRecord.revealedAreas as RevealedArea[];
    const areaIdSet = new Set(areaIds);
    const concealedAreas = currentAreas.filter((area) => areaIdSet.has(area.id));
    const remainingAreas = currentAreas.filter((area) => !areaIdSet.has(area.id));

    if (concealedAreas.length === 0) {
      return [];
    }

    // 🛡️ Sentinel: Atomic update with ownership check for defense-in-depth.
    const [updated] = await db
      .update(fogOfWar)
      .set({
        revealedAreas: remainingAreas,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(fogOfWar.id, existingRecord.id),
          eq(fogOfWar.sceneId, sceneId),
          eq(fogOfWar.userId, userId),
          this.getAccessFilter(sceneId, userId, requesterId)
        )
      )
      .returning();

    if (!updated) {
      throw new NotFoundError('Scene', sceneId);
    }

    // Broadcast to WebSocket if callback provided
    if (broadcast) {
      broadcast({
        type: 'fog:conceal',
        sceneId,
        userId,
        timestamp: Date.now(),
        data: {
          areas: concealedAreas,
          userId,
        },
      });
    }

    return concealedAreas;
  }

  /**
   * Clear all revealed areas for a user in a scene (reset fog of war)
   */
  static async resetFogOfWar(
    sceneId: string,
    userId: string,
    requesterId: string
  ): Promise<void> {
    // 🛡️ Sentinel: Refactored to use a single atomic UPDATE statement with inline ownership verification.
    const [updated] = await db
      .update(fogOfWar)
      .set({
        revealedAreas: [],
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(fogOfWar.sceneId, sceneId),
          eq(fogOfWar.userId, userId),
          this.getAccessFilter(sceneId, userId, requesterId)
        )
      )
      .returning({ id: fogOfWar.id });

    if (!updated) {
      // 🛡️ Sentinel: Verify access to maintain standard error behavior.
      await this.verifyAccess(sceneId, userId, requesterId);
    }
  }

  /**
   * Merge and optimize overlapping revealed areas
   * This is a simplified version - a full implementation would use polygon union algorithms
   * For now, this just removes duplicate area IDs
   */
  static async mergeRevealedAreas(
    sceneId: string,
    userId: string,
    requesterId: string
  ): Promise<RevealedArea[]> {
    // 🛡️ Sentinel: Combined verification and retrieval into a single query.
    const existingRecord = await db.query.fogOfWar.findFirst({
      where: and(
        eq(fogOfWar.sceneId, sceneId),
        eq(fogOfWar.userId, userId),
        this.getAccessFilter(sceneId, userId, requesterId)
      ),
    });

    if (!existingRecord) {
      // 🛡️ Sentinel: If no record was found, we still need to verify access to maintain standard error behavior.
      await this.verifyAccess(sceneId, userId, requesterId);
      return [];
    }

    const currentAreas = existingRecord.revealedAreas as RevealedArea[];

    // Remove duplicate IDs and invalid areas
    const seenIds = new Set<string>();
    const mergedAreas = currentAreas.filter((area) => {
      if (!area.id || seenIds.has(area.id)) {
        return false;
      }
      seenIds.add(area.id);
      return true;
    });

    // Update if we removed any duplicates
    if (mergedAreas.length !== currentAreas.length) {
      // 🛡️ Sentinel: Atomic update with ownership check for defense-in-depth.
      const [updated] = await db
        .update(fogOfWar)
        .set({
          revealedAreas: mergedAreas,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(fogOfWar.id, existingRecord.id),
            eq(fogOfWar.sceneId, sceneId),
            eq(fogOfWar.userId, userId),
            this.getAccessFilter(sceneId, userId, requesterId)
          )
        )
        .returning();

      if (!updated) {
        throw new NotFoundError('Scene', sceneId);
      }
    }

    return mergedAreas;
  }

  /**
   * Get the entire fog of war record for a user in a scene
   */
  static async getFogOfWarRecord(
    sceneId: string,
    userId: string,
    requesterId: string
  ): Promise<FogOfWar | null> {
    // 🛡️ Sentinel: Combined verification and retrieval into a single query.
    const record = await db.query.fogOfWar.findFirst({
      where: and(
        eq(fogOfWar.sceneId, sceneId),
        eq(fogOfWar.userId, userId),
        this.getAccessFilter(sceneId, userId, requesterId)
      ),
    });

    if (!record) {
      // 🛡️ Sentinel: If no record was found, we still need to verify access to maintain standard error behavior.
      await this.verifyAccess(sceneId, userId, requesterId);
    }

    return record || null;
  }

  /**
   * Delete fog of war record for a user in a scene
   */
  static async deleteFogOfWar(
    sceneId: string,
    userId: string,
    requesterId: string
  ): Promise<boolean> {
    // 🛡️ Sentinel: Refactored to use a single atomic DELETE statement with inline ownership verification.
    const result = await db
      .delete(fogOfWar)
      .where(
        and(
          eq(fogOfWar.sceneId, sceneId),
          eq(fogOfWar.userId, userId),
          this.getAccessFilter(sceneId, userId, requesterId)
        )
      )
      .returning({ id: fogOfWar.id });

    if (result.length === 0) {
      // 🛡️ Sentinel: If no row was deleted, verify access to distinguish between "unauthorized" and "not found".
      await this.verifyAccess(sceneId, userId, requesterId);
      return false;
    }

    return true;
  }
}
