/**
 * Character Folder Service
 *
 * Handles character folder operations for organizing characters.
 * Provides type-safe database queries for folder creation, updates,
 * deletion, and character movement between folders.
 *
 * @module server/services/character-folder-service
 */

import { TRPCError } from '@trpc/server';
import { and, asc, eq, exists, isNotNull, isNull, or, sql } from 'drizzle-orm';

import { db } from '../../../db/client';
import {
  characterFolders,
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
   * Build a nested folder structure from flat list
   */
  private static buildFolderTree(
    folders: CharacterFolder[],
    parentId: string | null = null
  ): FolderWithChildren[] {
    return folders
      .filter(folder => folder.parentFolderId === parentId)
      .map(folder => ({
        ...folder,
        children: this.buildFolderTree(folders, folder.id),
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
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
    // ⚡ Bolt: Parallelize fetching folders and character counts to reduce total latency.
    // Both operations are independent and can be executed concurrently.
    const [folders, counts] = await Promise.all([
      db.query.characterFolders.findMany({
        where: eq(characterFolders.userId, userId),
        orderBy: [asc(characterFolders.sortOrder)],
      }),
      // ⚡ Bolt: Use SQL aggregation (count/groupBy) instead of fetching all characters to memory.
      // This significantly reduces data transfer and memory usage as the character list grows.
      db
        .select({
          folderId: characters.folderId,
          count: sql<number>`count(*)::int`,
        })
        .from(characters)
        .where(
          and(
            isNotNull(characters.folderId),
            or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
          ),
        )
        .groupBy(characters.folderId),
    ]);

    const folderCounts = new Map<string, number>(counts.map((c) => [c.folderId as string, c.count]));

    const foldersWithCounts = folders.map(folder => ({
      ...folder,
      characterCount: folderCounts.get(folder.id) || 0,
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

    const [updated] = await db
      .update(characterFolders)
      .set({
        ...updates,
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
