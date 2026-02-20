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
export async function resolveAuthorId(
  ctx: Context,
  explicitAuthorId?: string
): Promise<string> {
  // If explicit author ID provided, validate it exists
  if (explicitAuthorId) {
    if (!ctx.user) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      });
    }

    const isAdmin = ctx.user.plan === 'admin' || ctx.user.plan === 'enterprise';

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
  publishedAt?: string | null
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

  // 🛡️ Sentinel: Incorporate ownership check into the INSERT query using SELECT for defense-in-depth.
  if (categoryIds.length > 0) {
    if (userAuthorId && !isAdmin) {
      await ctx.db.insert(blogPostCategories).select(
        ctx.db
          .select({
            postId: sql`${postId}`,
            categoryId: blogCategories.id,
          })
          .from(blogCategories)
          .where(
            and(
              inArray(blogCategories.id, categoryIds),
              exists(
                ctx.db
                  .select()
                  .from(blogPosts)
                  .where(and(eq(blogPosts.id, postId), eq(blogPosts.authorId, userAuthorId))),
              ),
            ),
          ),
      );
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

  // 🛡️ Sentinel: Incorporate ownership check into the INSERT query using SELECT for defense-in-depth.
  if (tagIds.length > 0) {
    if (userAuthorId && !isAdmin) {
      await ctx.db.insert(blogPostTags).select(
        ctx.db
          .select({
            postId: sql`${postId}`,
            tagId: blogTags.id,
          })
          .from(blogTags)
          .where(
            and(
              inArray(blogTags.id, tagIds),
              exists(
                ctx.db
                  .select()
                  .from(blogPosts)
                  .where(and(eq(blogPosts.id, postId), eq(blogPosts.authorId, userAuthorId))),
              ),
            ),
          ),
      );
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

  const isAdmin = ctx.user.plan === 'admin' || ctx.user.plan === 'enterprise';

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
