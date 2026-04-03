/**
 * Fog of War Service
 *
 * Manages user-specific fog of war revelation for scenes.
 * Each user has their own revealed areas per scene for exploration tracking.
 *
 * @module server/services/fog-of-war-service
 */

/* eslint-disable max-lines */
import { randomUUID } from 'crypto';

import { and, eq, or, sql } from 'drizzle-orm';

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
   * Internal helper to verify scene access and target user permissions
   */
  private static async verifyAccess(
    sceneId: string,
    targetUserId: string,
    requesterId: string
  ): Promise<void> {
    // ⚡ Bolt: Consolidated multiple authorization queries into a single joined query with EXISTS subqueries.
    // This reduces database round-trips from up to 3 down to 1 for EVERY fog of war operation.
    const [result] = await (db as any)
      .select({
        sceneOwnerId: scenes.userId,
        campaignId: scenes.campaignId,
        isRequesterParticipant: sql<boolean>`EXISTS (
          SELECT 1 FROM ${characters} c
          WHERE c.campaign_id = ${scenes.campaignId}
            AND (c.user_id = ${requesterId} OR c.owner_id = ${requesterId})
        )`,
        isTargetParticipant: sql<boolean>`EXISTS (
          SELECT 1 FROM ${characters} c
          WHERE c.campaign_id = ${scenes.campaignId}
            AND (c.user_id = ${targetUserId} OR c.owner_id = ${targetUserId})
        )`,
      })
      .from(scenes)
      .where(eq(scenes.id, sceneId))
      .limit(1);

    if (!result) {
      throw new NotFoundError('Scene', sceneId);
    }

    // Authorization logic:
    // - Requester is the scene owner
    // - OR requester is the target user AND has a character in the scene's campaign
    const isTarget = requesterId === targetUserId;
    const isOwner = requesterId === result.sceneOwnerId;

    // Scene owner may manage another user's fog only if that user participates in the campaign.
    if (isOwner) {
      if (!isTarget && !result.isTargetParticipant) {
        throw new NotFoundError('Scene', sceneId);
      }
      return;
    }

    // Non-owner can only access their own fog if they are a participant.
    if (!isTarget || !result.isRequesterParticipant) {
      // Throw NOT_FOUND to avoid leaking association existence
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
    await this.verifyAccess(sceneId, userId, requesterId);

    const fogRecord = await db.query.fogOfWar.findFirst({
      where: and(eq(fogOfWar.sceneId, sceneId), eq(fogOfWar.userId, userId)),
    });

    if (!fogRecord) {
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
    await this.verifyAccess(sceneId, userId, requesterId);

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

    // ⚡ Bolt: Optimized N+1 query pattern by replacing read-modify-write with a single atomic UPSERT.
    // This uses SQL jsonb_concat (||) to append new areas directly in the database,
    // which eliminates a round-trip and prevents race conditions between concurrent reveals.
    await db
      .insert(fogOfWar)
      .values({
        sceneId,
        userId,
        revealedAreas: newAreas,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [fogOfWar.sceneId, fogOfWar.userId],
        set: {
          revealedAreas: sql`${fogOfWar.revealedAreas} || ${JSON.stringify(newAreas)}::jsonb`,
          updatedAt: new Date(),
        },
      });

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
    await this.verifyAccess(sceneId, userId, requesterId);

    const existingRecord = await db.query.fogOfWar.findFirst({
      where: and(
        eq(fogOfWar.sceneId, sceneId),
        eq(fogOfWar.userId, userId)
      ),
    });

    if (!existingRecord) {
      return false;
    }

    const currentAreas = existingRecord.revealedAreas as RevealedArea[];
    const concealedArea = currentAreas.find((area) => area.id === areaId);
    const filteredAreas = currentAreas.filter((area) => area.id !== areaId);

    if (filteredAreas.length === currentAreas.length) {
      // Area ID not found
      return false;
    }

    await db
      .update(fogOfWar)
      .set({
        revealedAreas: filteredAreas,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(fogOfWar.id, existingRecord.id),
          eq(fogOfWar.sceneId, sceneId),
          eq(fogOfWar.userId, userId)
        )
      );

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
    await this.verifyAccess(sceneId, userId, requesterId);

    if (areaIds.length === 0) {
      return [];
    }

    const existingRecord = await db.query.fogOfWar.findFirst({
      where: and(
        eq(fogOfWar.sceneId, sceneId),
        eq(fogOfWar.userId, userId)
      ),
    });

    if (!existingRecord) {
      return [];
    }

    const currentAreas = existingRecord.revealedAreas as RevealedArea[];
    const areaIdSet = new Set(areaIds);
    const concealedAreas = currentAreas.filter((area) => areaIdSet.has(area.id));
    const remainingAreas = currentAreas.filter((area) => !areaIdSet.has(area.id));

    if (concealedAreas.length === 0) {
      return [];
    }

    await db
      .update(fogOfWar)
      .set({
        revealedAreas: remainingAreas,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(fogOfWar.id, existingRecord.id),
          eq(fogOfWar.sceneId, sceneId),
          eq(fogOfWar.userId, userId)
        )
      );

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
    await this.verifyAccess(sceneId, userId, requesterId);

    const existingRecord = await db.query.fogOfWar.findFirst({
      where: and(
        eq(fogOfWar.sceneId, sceneId),
        eq(fogOfWar.userId, userId)
      ),
    });

    if (!existingRecord) {
      // Nothing to reset
      return;
    }

    await db
      .update(fogOfWar)
      .set({
        revealedAreas: [],
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(fogOfWar.id, existingRecord.id),
          eq(fogOfWar.sceneId, sceneId),
          eq(fogOfWar.userId, userId)
        )
      );
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
    await this.verifyAccess(sceneId, userId, requesterId);

    const existingRecord = await db.query.fogOfWar.findFirst({
      where: and(
        eq(fogOfWar.sceneId, sceneId),
        eq(fogOfWar.userId, userId)
      ),
    });

    if (!existingRecord) {
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
      await db
        .update(fogOfWar)
        .set({
          revealedAreas: mergedAreas,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(fogOfWar.id, existingRecord.id),
            eq(fogOfWar.sceneId, sceneId),
            eq(fogOfWar.userId, userId)
          )
        );
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
    await this.verifyAccess(sceneId, userId, requesterId);

    const record = await db.query.fogOfWar.findFirst({
      where: and(eq(fogOfWar.sceneId, sceneId), eq(fogOfWar.userId, userId)),
    });

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
    await this.verifyAccess(sceneId, userId, requesterId);

    const existingRecord = await db.query.fogOfWar.findFirst({
      where: and(
        eq(fogOfWar.sceneId, sceneId),
        eq(fogOfWar.userId, userId)
      ),
    });

    if (!existingRecord) {
      return false;
    }

    await db
      .delete(fogOfWar)
      .where(
        and(
          eq(fogOfWar.id, existingRecord.id),
          eq(fogOfWar.sceneId, sceneId),
          eq(fogOfWar.userId, userId)
        )
      );

    return true;
  }
}
