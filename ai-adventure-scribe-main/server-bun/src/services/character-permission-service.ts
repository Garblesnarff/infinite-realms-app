/**
 * Character Permission Service
 *
 * Handles character permission management operations using Drizzle ORM.
 * Provides type-safe database queries for sharing characters, updating permissions,
 * and checking access rights.
 *
 * @module server/services/character-permission-service
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { TRPCError } from '@trpc/server';
import { and, desc, eq, exists, isNotNull, or, sql } from 'drizzle-orm';

import { db } from '../../../db/client';
import {
  characterPermissions,
  characterStats,
  characters,
} from '../../../db/schema/index';
import { InternalServerError } from '../lib/errors.js';

import type {
  Character,
  CharacterPermission,
  PermissionLevel,
} from '../../../db/schema/index';

export class CharacterPermissionService {
  /**
   * Check if user has permission to access character
   */
  static async checkPermission(
    characterId: string,
    userId: string,
    requiredLevel?: 'viewer' | 'editor' | 'owner'
  ): Promise<{ hasAccess: boolean; permission?: CharacterPermission; isOwner: boolean }> {
    // ⚡ Bolt: Optimized to use a single query with leftJoin to avoid redundant 1+1 query pattern.
    // This improves performance for every authorization check by reducing database round-trips.
    const [result] = await (db as any)
      .select({
        userId: characters.userId,
        ownerId: characters.ownerId,
        permission: characterPermissions,
      })
      .from(characters)
      .leftJoin(
        characterPermissions,
        and(
          eq(characterPermissions.characterId, characters.id),
          eq(characterPermissions.userId, userId)
        )
      )
      .where(and(
        eq(characters.id, characterId),
        or(
          eq(characters.userId, userId),
          eq(characters.ownerId, userId),
          isNotNull(characterPermissions.id)
        )
      ))
      .limit(1);

    if (!result) {
      return { hasAccess: false, isOwner: false };
    }

    const isOwner = result.userId === userId || result.ownerId === userId;

    if (isOwner) {
      return { hasAccess: true, isOwner: true };
    }

    const permission = result.permission;

    if (!permission) {
      return { hasAccess: false, isOwner: false };
    }

    // If a specific permission level is required, check it
    if (requiredLevel) {
      const permissionLevels: Record<string, number> = { viewer: 1, editor: 2, owner: 3 };
      const hasRequiredLevel =
        permissionLevels[permission.permissionLevel] >= permissionLevels[requiredLevel];

      return {
        hasAccess: hasRequiredLevel,
        permission: permission as CharacterPermission,
        isOwner: false,
      };
    }

    return { hasAccess: true, permission: permission as CharacterPermission, isOwner: false };
  }

  /**
   * Share a character with another user
   */
  static async shareCharacter(
    characterId: string,
    userId: string,
    targetUserId: string,
    permission: PermissionLevel
  ): Promise<CharacterPermission> {
    // 🛡️ Sentinel: Combined ownership and existence check to prevent IDOR and race conditions.
    // Use an atomic query to verify the requester owns the character and check for existing permissions.
    const [result] = await db
      .select({
        characterId: characters.id,
        existingPermissionId: characterPermissions.id,
      })
      .from(characters)
      .leftJoin(
        characterPermissions,
        and(
          eq(characterPermissions.characterId, characters.id),
          eq(characterPermissions.userId, targetUserId)
        )
      )
      .where(
        and(
          eq(characters.id, characterId),
          or(eq(characters.userId, userId), eq(characters.ownerId, userId))
        )
      )
      .limit(1);

    if (!result) {
      // 🛡️ Sentinel: Throw NOT_FOUND for unauthorized access to mask resource existence.
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Character not found',
      });
    }

    if (result.existingPermissionId) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'Permission already exists for this user',
      });
    }

    // 🛡️ Sentinel: Incorporate ownership check into the INSERT query using SELECT for defense-in-depth.
    const [newPermission] = await db
      .insert(characterPermissions)
      .select(
        db
          .select({
            characterId: sql`${characterId}`,
            userId: sql`${targetUserId}`,
            permissionLevel: sql`${permission}`,
            canControlToken: sql`${permission === 'editor' || permission === 'owner'}`,
            canEditSheet: sql`${permission === 'editor' || permission === 'owner'}`,
            grantedBy: sql`${userId}`,
          })
          .from(characters)
          .where(
            and(
              eq(characters.id, characterId),
              or(eq(characters.userId, userId), eq(characters.ownerId, userId))
            )
          )
      )
      .returning();

    if (!newPermission) {
      throw new InternalServerError('Failed to create permission');
    }

    return newPermission;
  }

  /**
   * Update permission for a user
   */
  static async updatePermission(
    characterId: string,
    userId: string,
    targetUserId: string,
    permission: PermissionLevel
  ): Promise<CharacterPermission> {
    // 🛡️ Sentinel: Atomic update with inline ownership check (must be owner to modify permissions).
    const [updated] = await db
      .update(characterPermissions)
      .set({
        permissionLevel: permission,
        canControlToken: permission === 'editor' || permission === 'owner',
        canEditSheet: permission === 'editor' || permission === 'owner',
      })
      .where(
        and(
          eq(characterPermissions.characterId, characterId),
          eq(characterPermissions.userId, targetUserId),
          exists(
            db
              .select()
              .from(characters)
              .where(
                and(
                  eq(characters.id, characterId),
                  or(eq(characters.userId, userId), eq(characters.ownerId, userId))
                )
              )
          )
        )
      )
      .returning();

    if (!updated) {
      // 🛡️ Sentinel: Throw NOT_FOUND for unauthorized access or missing permission to mask existence.
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Permission not found',
      });
    }

    return updated;
  }

  /**
   * Revoke permission from a user
   */
  static async revokePermission(
    characterId: string,
    userId: string,
    targetUserId: string
  ): Promise<boolean> {
    // 🛡️ Sentinel: Atomic delete with inline ownership check (must be owner to revoke permissions).
    const result = await db
      .delete(characterPermissions)
      .where(
        and(
          eq(characterPermissions.characterId, characterId),
          eq(characterPermissions.userId, targetUserId),
          exists(
            db
              .select()
              .from(characters)
              .where(
                and(
                  eq(characters.id, characterId),
                  or(eq(characters.userId, userId), eq(characters.ownerId, userId))
                )
              )
          )
        )
      )
      .returning({ id: characterPermissions.id });

    return result.length > 0;
  }

  /**
   * List all characters shared with a user
   */
  static async listSharedCharacters(userId: string): Promise<Array<Character & { permission: CharacterPermission }>> {
    // ⚡ Bolt: Consolidated permission check, character retrieval, and stats into a single joined query.
    // This eliminates the N+1 problem for shared characters by eager-loading stats (HP, attributes)
    // needed for the character selection UI.
    const results = await (db as any)
      .select({
        character: {
          id: characters.id,
          name: characters.name,
          race: characters.race,
          class: characters.class,
          level: characters.level,
          imageUrl: characters.imageUrl,
          avatarUrl: characters.avatarUrl,
          campaignId: characters.campaignId,
          createdAt: characters.createdAt,
          updatedAt: characters.updatedAt,
        },
        stats: characterStats,
        permission: characterPermissions,
      })
      .from(characterPermissions)
      .innerJoin(characters, eq(characterPermissions.characterId, characters.id))
      .leftJoin(characterStats, eq(characters.id, characterStats.characterId))
      .where(eq(characterPermissions.userId, userId))
      .orderBy(desc(characterPermissions.grantedAt));

    return results.map((r: any) => ({
      ...r.character,
      stats: r.stats,
      permission: r.permission,
    }));
  }

  /**
   * List all permissions for a character
   */
  static async listPermissions(
    characterId: string,
    userId: string
  ): Promise<CharacterPermission[]> {
    // 🛡️ Sentinel: Incorporate ownership check directly into the query for defense-in-depth.
    // We use a join to verify ownership while fetching permissions in a single round-trip.
    const results = await db
      .select({
        permission: characterPermissions,
        ownerId: characters.ownerId,
        charUserId: characters.userId,
      })
      .from(characters)
      .leftJoin(characterPermissions, eq(characterPermissions.characterId, characters.id))
      .where(
        and(
          eq(characters.id, characterId),
          or(eq(characters.userId, userId), eq(characters.ownerId, userId))
        )
      );

    if (results.length === 0) {
      // 🛡️ Sentinel: Throw NOT_FOUND for unauthorized access to mask resource existence.
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Character not found',
      });
    }

    // Filter out null permissions (caused by leftJoin when character has no permissions)
    return results
      .map((r) => r.permission)
      .filter((p): p is CharacterPermission => p !== null);
  }
}
