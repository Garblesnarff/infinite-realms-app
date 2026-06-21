/**
 * Character Folder Service
 *
 * Handles character folder operations for organizing characters.
 * Provides type-safe database queries for folder creation, updates,
 * deletion, and character movement between folders.
 *
 * @module server/services/character-folder-service
 */

/* eslint-disable max-lines */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { TRPCError } from '@trpc/server';
import { and, asc, eq, exists, isNull, or, sql } from 'drizzle-orm';

import { db } from '../../../db/client';
import {
  characterFolders,
  characterPermissions,
  characters,
  type CharacterFolder,
} from '../../../db/schema/index';
import { InternalServerError } from '../lib/errors.js';

export interface CreateFolderData {
  name: string;
  parentFolderId?: string | null;
  color?: string;
  icon?: string;
  sortOrder?: number;
}

export interface FolderWithChildren extends CharacterFolder {
  children: FolderWithChildren[];
  characterCount?: number;
}

export class CharacterFolderService {
  /**
   * Build a nested folder structure from flat list using Map-based O(N) approach.
   * ⚡ Bolt: Replaced recursive O(N^2) filter with O(N) grouping.
   * Preservation of database sorting (sortOrder) is maintained by Map insertion order.
   */
  private static buildFolderTree(
    folders: (CharacterFolder & { characterCount?: number })[]
  ): FolderWithChildren[] {
    const folderMap = new Map<string | null, FolderWithChildren[]>();
    const allFolders: FolderWithChildren[] = folders.map((f) => ({ ...f, children: [] }));

    // Group folders by their parentFolderId
    for (const folder of allFolders) {
      const parentId = folder.parentFolderId;
      let group = folderMap.get(parentId);
      if (!group) {
        group = [];
        folderMap.set(parentId, group);
      }
      group.push(folder);
    }

    // Link children to their parents
    for (const folder of allFolders) {
      folder.children = folderMap.get(folder.id) || [];
    }

    // Return the top-level folders
    return folderMap.get(null) || [];
  }

  /**
   * Get all folder IDs in a subtree (including the folder itself)
   */
  private static async getFolderSubtree(folderId: string, userId: string): Promise<string[]> {
    // ⚡ Bolt: Optimized to use a PostgreSQL recursive CTE to fetch only the relevant subtree IDs.
    // This replaces the previous in-memory calculation which required fetching ALL folders for the user.
    // Reduces database data transfer and application memory usage from O(N) to O(Subtree).
    const results = await db.execute<{ id: string }>(sql`
      WITH RECURSIVE folder_subtree AS (
        SELECT ${characterFolders.id} FROM ${characterFolders}
        WHERE ${characterFolders.id} = ${folderId} AND ${characterFolders.userId} = ${userId}
        UNION ALL
        SELECT f.${characterFolders.id} FROM ${characterFolders} f
        JOIN folder_subtree fs ON f.${characterFolders.parentFolderId} = fs.${characterFolders.id}
        WHERE f.${characterFolders.userId} = ${userId}
      )
      SELECT ${characterFolders.id} FROM folder_subtree
    `);

    return results.map((r) => r.id as string);
  }

  /**
   * List all folders for a user with nested structure
   */
  static async listFolders(userId: string): Promise<FolderWithChildren[]> {
    // ⚡ Bolt: Consolidated folder retrieval and character counts into a single query using a leftJoin.
    // This reduces database round-trips from 2 to 1 and improves memory efficiency by avoiding
    // in-memory Map aggregation.
    const results = await (db as any)
      .select({
        folder: characterFolders,
        characterCount: sql<number>`count(${characters.id})::int`,
      })
      .from(characterFolders)
      .leftJoin(
        characters,
        and(
          eq(characters.folderId, characterFolders.id),
          or(
            eq(characters.userId, userId),
            eq(characters.ownerId, userId),
            exists(
              db.select()
                .from(characterPermissions)
                .where(and(
                  eq(characterPermissions.characterId, characters.id),
                  eq(characterPermissions.userId, userId)
                ))
            )
          )
        )
      )
      .where(eq(characterFolders.userId, userId))
      .groupBy(characterFolders.id)
      .orderBy(asc(characterFolders.sortOrder));

    const foldersWithCounts = results.map((r: any) => ({
      ...r.folder,
      characterCount: r.characterCount || 0,
    }));

    return this.buildFolderTree(foldersWithCounts);
  }

  /**
   * Create a new folder
   */
  static async createFolder(userId: string, data: CreateFolderData): Promise<CharacterFolder> {
    // Get next sort order if not provided
    let sortOrder = data.sortOrder ?? 0;
    if (data.sortOrder === undefined) {
      // ⚡ Bolt: Optimized to use SQL MAX() aggregation instead of fetching all folders at the same level.
      // This reduces data transfer and memory usage during folder creation.
      const [maxResult] = await db
        .select({
          maxSortOrder: sql<number>`max(${characterFolders.sortOrder})`,
        })
        .from(characterFolders)
        .where(
          and(
            eq(characterFolders.userId, userId),
            data.parentFolderId
              ? eq(characterFolders.parentFolderId, data.parentFolderId)
              : isNull(characterFolders.parentFolderId)
          )
        );

      sortOrder = (maxResult?.maxSortOrder ?? -1) + 1;
    }

    // 🛡️ Sentinel: Refactored to use atomic INSERT ... SELECT when a parent folder is provided.
    // This ensures that the parent folder belongs to the user in a single atomic operation
    // while masking resource existence.
    let folder: CharacterFolder | undefined;

    if (data.parentFolderId) {
      [folder] = await db
        .insert(characterFolders)
        .select(
          db.select({
            userId: sql`${userId}`,
            name: sql`${data.name}`,
            parentFolderId: characterFolders.id,
            color: sql`${data.color || null}`,
            icon: sql`${data.icon || null}`,
            sortOrder: sql`${sortOrder}`,
          })
          .from(characterFolders)
          .where(and(
            eq(characterFolders.id, data.parentFolderId),
            eq(characterFolders.userId, userId)
          ))
        )
        .returning();
    } else {
      [folder] = await db
        .insert(characterFolders)
        .values({
          userId,
          name: data.name,
          parentFolderId: null,
          color: data.color || null,
          icon: data.icon || null,
          sortOrder,
        })
        .returning();
    }

    if (!folder) {
      // 🛡️ Sentinel: Throw NOT_FOUND for unauthorized access or missing parent to mask existence.
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Parent folder not found',
      });
    }

    return folder;
  }

  /**
   * Update a folder
   */
  static async updateFolder(
    folderId: string,
    userId: string,
    updates: Partial<CharacterFolder>
  ): Promise<CharacterFolder> {
    // Verify ownership
    const existingFolder = await db.query.characterFolders.findFirst({
      where: and(
        eq(characterFolders.id, folderId),
        eq(characterFolders.userId, userId)
      ),
    });

    if (!existingFolder) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Folder not found',
      });
    }

    // Prevent moving folder to be its own child
    if (updates.parentFolderId) {
      // ⚡ Bolt: Parallelize independent validation checks (subtree retrieval and parent existence)
      // to reduce database round-trip sum during folder movement.
      const [subtree, parentFolder] = await Promise.all([
        this.getFolderSubtree(folderId, userId),
        db.query.characterFolders.findFirst({
          where: and(
            eq(characterFolders.id, updates.parentFolderId),
            eq(characterFolders.userId, userId),
          ),
        }),
      ]);

      if (subtree.includes(updates.parentFolderId)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot move folder to be a child of itself',
        });
      }

      if (!parentFolder) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Parent folder not found',
        });
      }
    }

    // 🛡️ Sentinel: Explicitly destructure to prevent Mass Assignment of sensitive fields
    const {
      id: _id,
      userId: _userId,
      ...safeUpdates
    } = updates as Partial<CharacterFolder>;

    const [updated] = await db
      .update(characterFolders)
      .set({
        ...safeUpdates,
        updatedAt: new Date(),
      })
      .where(and(
        eq(characterFolders.id, folderId),
        eq(characterFolders.userId, userId)
      ))
      .returning();

    if (!updated) {
      throw new InternalServerError('Failed to update folder');
    }

    return updated;
  }

  /**
   * Delete a folder (moves characters to parent or root)
   */
  static async deleteFolder(folderId: string, userId: string): Promise<boolean> {
    // Verify ownership
    const folder = await db.query.characterFolders.findFirst({
      where: and(
        eq(characterFolders.id, folderId),
        eq(characterFolders.userId, userId)
      ),
    });

    if (!folder) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Folder not found',
      });
    }

    // ⚡ Bolt: Parallelize character and subfolder migration to reduce total latency.
    // These updates are independent and can be executed concurrently.
    await Promise.all([
      // Move all characters in this folder to the parent folder (or root if no parent)
      db
        .update(characters)
        .set({ folderId: folder.parentFolderId })
        .where(
          and(
            eq(characters.folderId, folderId),
            or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
          ),
        ),
      // Move all subfolders to the parent folder (or root if no parent)
      db
        .update(characterFolders)
        .set({ parentFolderId: folder.parentFolderId })
        .where(and(eq(characterFolders.parentFolderId, folderId), eq(characterFolders.userId, userId))),
    ]);

    // Delete the folder
    const result = await db
      .delete(characterFolders)
      .where(and(
        eq(characterFolders.id, folderId),
        eq(characterFolders.userId, userId)
      ))
      .returning({ id: characterFolders.id });

    return result.length > 0;
  }

  /**
   * Move a character to a folder
   */
  static async moveCharacterToFolder(
    characterId: string,
    folderId: string | null,
    userId: string
  ): Promise<boolean> {
    // 🛡️ Sentinel: Refactored to use a single atomic UPDATE statement with inline ownership verification.
    // This eliminates multiple pre-flight queries and prevents IDOR while masking resource existence.
    const [updated] = await db
      .update(characters)
      .set({
        folderId: folderId,
        updatedAt: new Date(),
      })
      .where(and(
        eq(characters.id, characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
        folderId
          ? exists(
              db.select()
                .from(characterFolders)
                .where(and(
                  eq(characterFolders.id, folderId),
                  eq(characterFolders.userId, userId)
                ))
            )
          : sql`true`
      ))
      .returning({ id: characters.id });

    if (!updated) {
      // 🛡️ Sentinel: Throw NOT_FOUND for unauthorized access or missing resource to mask existence.
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Character or folder not found',
      });
    }

    return true;
  }
}
