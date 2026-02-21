/**
 * Blog Taxonomy Router
 *
 * tRPC procedures for blog categories and tags management.
 * Separated from main blog router for maintainability.
 */

import { TRPCError } from '@trpc/server';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  blogCategories,
  blogPosts,
  blogPostCategories,
  blogPostTags,
  blogTags,
} from '../../../../db/schema/index';
import { adminProcedure, protectedProcedure, publicProcedure, router } from '../trpc.js';
import { canManagePost, syncPostCategories, syncPostTags } from './blog-helpers.js';
import { blogCategorySchema, blogTagSchema } from './blog-schemas.js';

export const blogTaxonomyRouter = router({
  /**
   * Get all categories (PUBLIC)
   */
  getCategories: publicProcedure
    .input(z.object({ includeCount: z.boolean().default(false) }))
    .query(async ({ input, ctx }) => {
      if (!input.includeCount) {
        return await ctx.db.select().from(blogCategories).orderBy(blogCategories.name);
      }

      // ⚡ Bolt: Consolidated category list and post counts into a single joined query.
      // This reduces database round-trips from 2 to 1 and improves performance.
      const results = await ctx.db
        .select({
          category: blogCategories,
          postCount: sql<number>`count(${blogPostCategories.postId})::int`,
        })
        .from(blogCategories)
        .leftJoin(blogPostCategories, eq(blogCategories.id, blogPostCategories.categoryId))
        .groupBy(blogCategories.id)
        .orderBy(blogCategories.name);

      return results.map((r) => ({
        ...r.category,
        postCount: r.postCount,
      }));
    }),

  /**
   * Get all tags (PUBLIC)
   */
  getTags: publicProcedure
    .input(z.object({ includeCount: z.boolean().default(false) }))
    .query(async ({ input, ctx }) => {
      if (!input.includeCount) {
        return await ctx.db.select().from(blogTags).orderBy(blogTags.name);
      }

      // ⚡ Bolt: Consolidated tag list and post counts into a single joined query.
      // This reduces database round-trips from 2 to 1 and improves performance.
      const results = await ctx.db
        .select({
          tag: blogTags,
          postCount: sql<number>`count(${blogPostTags.postId})::int`,
        })
        .from(blogTags)
        .leftJoin(blogPostTags, eq(blogTags.id, blogPostTags.tagId))
        .groupBy(blogTags.id)
        .orderBy(blogTags.name);

      return results.map((r) => ({
        ...r.tag,
        postCount: r.postCount,
      }));
    }),

  /**
   * Create category (PROTECTED - admin only in production)
   */
  createCategory: adminProcedure
    .input(blogCategorySchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const [category] = await ctx.db
          .insert(blogCategories)
          .values({
            ...input,
            metadata: {},
          })
          .returning();

        return category;
      } catch (error: any) {
        // Handle unique constraint violation (duplicate slug)
        if (error?.code === '23505') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Category slug already exists',
          });
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create category',
        });
      }
    }),

  /**
   * Update category (PROTECTED - admin only in production)
   */
  updateCategory: adminProcedure
    .input(z.object({ id: z.string().uuid(), updates: blogCategorySchema.partial() }))
    .mutation(async ({ input, ctx }) => {
      const { id, updates } = input;

      if (Object.keys(updates).length === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Nothing to update',
        });
      }

      try {
        const [category] = await ctx.db
          .update(blogCategories)
          .set({ ...updates, updatedAt: new Date() })
          .where(eq(blogCategories.id, id))
          .returning();

        if (!category) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Category not found' });
        }

        return category;
      } catch (error: any) {
        if (error instanceof TRPCError) throw error;

        if (error?.code === '23505') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Category slug already exists',
          });
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update category',
        });
      }
    }),

  /**
   * Delete category (PROTECTED)
   */
  deleteCategory: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      // ⚡ Bolt: Removed manual deletion of post associations.
      // The schema defines ON DELETE CASCADE for blog_post_categories.category_id,
      // so deleting the category automatically removes all associations in one round-trip.
      await ctx.db.delete(blogCategories).where(eq(blogCategories.id, input.id));

      return { success: true };
    }),

  /**
   * Create tag (PROTECTED - admin only in production)
   */
  createTag: adminProcedure.input(blogTagSchema).mutation(async ({ input, ctx }) => {
    try {
      const [tag] = await ctx.db
        .insert(blogTags)
        .values({
          ...input,
          metadata: {},
        })
        .returning();

      return tag;
    } catch (error: any) {
      if (error?.code === '23505') {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Tag slug already exists',
        });
      }
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to create tag',
      });
    }
  }),

  /**
   * Update tag (PROTECTED - admin only in production)
   */
  updateTag: adminProcedure
    .input(z.object({ id: z.string().uuid(), updates: blogTagSchema.partial() }))
    .mutation(async ({ input, ctx }) => {
      const { id, updates } = input;

      if (Object.keys(updates).length === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Nothing to update',
        });
      }

      try {
        const [tag] = await ctx.db
          .update(blogTags)
          .set({ ...updates, updatedAt: new Date() })
          .where(eq(blogTags.id, id))
          .returning();

        if (!tag) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Tag not found' });
        }

        return tag;
      } catch (error: any) {
        if (error instanceof TRPCError) throw error;

        if (error?.code === '23505') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Tag slug already exists',
          });
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update tag',
        });
      }
    }),

  /**
   * Delete tag (PROTECTED - admin only in production)
   */
  deleteTag: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      // ⚡ Bolt: Removed manual deletion of post associations.
      // The schema defines ON DELETE CASCADE for blog_post_tags.tag_id,
      // so deleting the tag automatically removes all associations in one round-trip.
      await ctx.db.delete(blogTags).where(eq(blogTags.id, input.id));

      return { success: true };
    }),

  /**
   * Add categories to a post (PROTECTED)
   * Replaces existing category associations with new ones
   */
  addCategoriesToPost: protectedProcedure
    .input(
      z.object({
        postId: z.string().uuid(),
        categoryIds: z.array(z.string().uuid()).min(1).max(10),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const [post] = await ctx.db
        .select({ id: blogPosts.id, authorId: blogPosts.authorId })
        .from(blogPosts)
        .where(eq(blogPosts.id, input.postId))
        .limit(1);

      if (!post) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Blog post not found' });
      }

      const { canManage, userAuthorId, isAdmin } = await canManagePost(
        ctx,
        input.postId,
        post.authorId,
      );
      if (!canManage) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Blog post not found' });
      }

      // 🛡️ Sentinel: Use hardened helper with atomic ownership checks.
      await syncPostCategories(ctx, input.postId, input.categoryIds, userAuthorId, isAdmin);

      return { success: true };
    }),

  /**
   * Add tags to a post (PROTECTED)
   * Replaces existing tag associations with new ones
   */
  addTagsToPost: protectedProcedure
    .input(
      z.object({
        postId: z.string().uuid(),
        tagIds: z.array(z.string().uuid()).min(1).max(20),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const [post] = await ctx.db
        .select({ id: blogPosts.id, authorId: blogPosts.authorId })
        .from(blogPosts)
        .where(eq(blogPosts.id, input.postId))
        .limit(1);

      if (!post) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Blog post not found' });
      }

      const { canManage, userAuthorId, isAdmin } = await canManagePost(
        ctx,
        input.postId,
        post.authorId,
      );
      if (!canManage) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Blog post not found' });
      }

      // 🛡️ Sentinel: Use hardened helper with atomic ownership checks.
      await syncPostTags(ctx, input.postId, input.tagIds, userAuthorId, isAdmin);

      return { success: true };
    }),
});
