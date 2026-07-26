/**
 * Blog Helper Functions
 *
 * Utility functions for blog post operations including:
 * - Author resolution
 * - Status field normalization
 * - Post relation management
 */

/* eslint-disable max-lines */
import { TRPCError } from '@trpc/server';
import { and, eq, exists, inArray, sql } from 'drizzle-orm';

import {
  blogAuthors,
  blogCategories,
  blogPosts,
  blogPostCategories,
  blogPostTags,
  blogTags,
} from '../../../../db/schema/index';

import type { Context } from '../context.js';

/**
 * Resolve author ID for the current user
 * If authorId is provided (admin override), validates it exists
 * Otherwise, fetches author profile for current user
 */
export async function resolveAuthorId(ctx: Context, explicitAuthorId?: string): Promise<string> {
  // If explicit author ID provided, validate it exists
  if (explicitAuthorId) {
    if (!ctx.user) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      });
    }

    const isAdmin = ctx.user.plan === 'admin';

    if (isAdmin) {
      const [author] = await ctx.db
        .select({ id: blogAuthors.id })
        .from(blogAuthors)
        .where(eq(blogAuthors.id, explicitAuthorId))
        .limit(1);

      if (!author) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Author not found',
        });
      }
      return author.id;
    }

    const [ownAuthor] = await ctx.db
      .select({ id: blogAuthors.id })
      .from(blogAuthors)
      .where(and(eq(blogAuthors.id, explicitAuthorId), eq(blogAuthors.userId, ctx.user.userId)))
      .limit(1);

    if (!ownAuthor) {
      // Mask unauthorized overrides as not found.
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Author not found',
      });
    }

    return ownAuthor.id;
  }

  // Otherwise, get author ID for current user
  if (!ctx.user) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
    });
  }

  const [author] = await ctx.db
    .select({ id: blogAuthors.id })
    .from(blogAuthors)
    .where(eq(blogAuthors.userId, ctx.user.userId))
    .limit(1);

  if (!author) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'You must create an author profile before creating posts',
    });
  }

  return author.id;
}

/**
 * Normalize status-related fields based on post status
 * Ensures proper values for publishedAt and scheduledFor
 */
export function normalizeStatusFields(
  status: 'draft' | 'review' | 'scheduled' | 'published' | 'archived',
  scheduledFor?: string | null,
  publishedAt?: string | null,
): {
  status: 'draft' | 'review' | 'scheduled' | 'published' | 'archived';
  publishedAt: Date | null;
  scheduledFor: Date | null;
} {
  switch (status) {
    case 'published':
      return {
        status: 'published',
        publishedAt: publishedAt ? new Date(publishedAt) : new Date(),
        scheduledFor: null,
      };

    case 'scheduled':
      return {
        status: 'scheduled',
        scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
        publishedAt: null,
      };

    case 'draft':
    case 'review':
    case 'archived':
    default:
      return {
        status,
        publishedAt: null,
        scheduledFor: null,
      };
  }
}

/**
 * Sync both categories and tags in parallel to avoid redundant sequential round-trips.
 * Uses Promise.all to run category and tag synchronization tasks simultaneously.
 */
export async function syncPostRelations(
  ctx: Context,
  postId: string,
  categoryIds?: string[],
  tagIds?: string[],
  userAuthorId?: string | null,
  isAdmin?: boolean,
): Promise<void> {
  // ⚡ Bolt: Parallelize category and tag synchronization to reduce sequential database round-trips.
  const tasks: Promise<void>[] = [];

  if (categoryIds !== undefined) {
    tasks.push(syncPostCategories(ctx, postId, categoryIds, userAuthorId, isAdmin));
  }

  if (tagIds !== undefined) {
    tasks.push(syncPostTags(ctx, postId, tagIds, userAuthorId, isAdmin));
  }

  if (tasks.length > 0) {
    await Promise.all(tasks);
  }
}

/**
 * Sync post categories
 * Deletes existing relationships and creates new ones
 */
export async function syncPostCategories(
  ctx: Context,
  postId: string,
  categoryIds: string[],
  userAuthorId?: string | null,
  isAdmin?: boolean,
): Promise<void> {
  // 🛡️ Sentinel: Incorporate ownership check into the DELETE query for defense-in-depth.
  await ctx.db.delete(blogPostCategories).where(
    and(
      eq(blogPostCategories.postId, postId),
      userAuthorId && !isAdmin
        ? exists(
            ctx.db
              .select()
              .from(blogPosts)
              .where(and(eq(blogPosts.id, postId), eq(blogPosts.authorId, userAuthorId))),
          )
        : undefined,
    ),
  );

  // The non-admin branch used to be an insert-select. blog_post_categories has
  // three columns (postId, categoryId, assignedAt) and the projection listed two,
  // so Drizzle threw and a non-admin author could never categorise their own post.
  // Split into the two things the subquery was doing: prove authorship, then
  // resolve the category ids that actually exist.
  if (categoryIds.length > 0) {
    if (userAuthorId && !isAdmin) {
      const owned = await ctx.db
        .select({ one: sql`1` })
        .from(blogPosts)
        .where(and(eq(blogPosts.id, postId), eq(blogPosts.authorId, userAuthorId)))
        .limit(1);

      // Silently a no-op for a post the caller does not own -- matching the old
      // subquery, which simply selected zero rows to insert.
      if (owned.length > 0) {
        const valid = await ctx.db
          .select({ id: blogCategories.id })
          .from(blogCategories)
          .where(inArray(blogCategories.id, categoryIds));

        if (valid.length > 0) {
          await ctx.db.insert(blogPostCategories).values(
            valid.map((category) => ({
              postId,
              categoryId: category.id,
            })),
          );
        }
      }
    } else {
      await ctx.db.insert(blogPostCategories).values(
        categoryIds.map((categoryId) => ({
          postId,
          categoryId,
        })),
      );
    }
  }
}

/**
 * Sync post tags
 * Deletes existing relationships and creates new ones
 */
export async function syncPostTags(
  ctx: Context,
  postId: string,
  tagIds: string[],
  userAuthorId?: string | null,
  isAdmin?: boolean,
): Promise<void> {
  // 🛡️ Sentinel: Incorporate ownership check into the DELETE query for defense-in-depth.
  await ctx.db.delete(blogPostTags).where(
    and(
      eq(blogPostTags.postId, postId),
      userAuthorId && !isAdmin
        ? exists(
            ctx.db
              .select()
              .from(blogPosts)
              .where(and(eq(blogPosts.id, postId), eq(blogPosts.authorId, userAuthorId))),
          )
        : undefined,
    ),
  );

  // Same conversion as syncPostCategories above, for the same reason.
  if (tagIds.length > 0) {
    if (userAuthorId && !isAdmin) {
      const owned = await ctx.db
        .select({ one: sql`1` })
        .from(blogPosts)
        .where(and(eq(blogPosts.id, postId), eq(blogPosts.authorId, userAuthorId)))
        .limit(1);

      if (owned.length > 0) {
        const valid = await ctx.db
          .select({ id: blogTags.id })
          .from(blogTags)
          .where(inArray(blogTags.id, tagIds));

        if (valid.length > 0) {
          await ctx.db.insert(blogPostTags).values(
            valid.map((tag) => ({
              postId,
              tagId: tag.id,
            })),
          );
        }
      }
    } else {
      await ctx.db.insert(blogPostTags).values(
        tagIds.map((tagId) => ({
          postId,
          tagId,
        })),
      );
    }
  }
}

/**
 * Check if user can manage a post
 * Users can manage their own posts, admins can manage all posts
 * Returns an object containing canManage flag and the user's authorId
 */
export async function canManagePost(
  ctx: Context,
  postId: string,
  postAuthorId: string,
): Promise<{ canManage: boolean; userAuthorId: string | null; isAdmin: boolean }> {
  if (!ctx.user) {
    return { canManage: false, userAuthorId: null, isAdmin: false };
  }

  const isAdmin = ctx.user.plan === 'admin';

  // Get current user's author profile
  const [userAuthor] = await ctx.db
    .select({ id: blogAuthors.id })
    .from(blogAuthors)
    .where(eq(blogAuthors.userId, ctx.user.userId))
    .limit(1);

  const userAuthorId = userAuthor?.id || null;

  // User can manage if they're the author
  if (userAuthorId === postAuthorId) {
    return { canManage: true, userAuthorId, isAdmin };
  }

  // Admin users can manage all posts
  if (isAdmin) {
    return { canManage: true, userAuthorId, isAdmin };
  }

  return { canManage: false, userAuthorId, isAdmin };
}
