/* eslint-disable max-lines */
/**
 * Blog Posts Router
 *
 * tRPC procedures for blog post CRUD operations.
 * Split from main blog router to maintain file size limits.
 */

import { TRPCError } from '@trpc/server';
import { and, desc, eq, exists, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import {
  blogAuthors,
  blogCategories,
  blogPosts,
  blogPostCategories,
  blogPostTags,
  blogTags,
} from '../../../../db/schema/index';
import { protectedProcedure, publicProcedure, router } from '../trpc.js';
import {
  canManagePost,
  normalizeStatusFields,
  resolveAuthorId,
  syncPostRelations,
} from './blog-helpers.js';
import {
  blogListQuerySchema,
  blogPostInputSchema,
  blogPostUpdateSchema,
} from './blog-schemas.js';

/**
 * Fetch categories and tags for multiple posts in batch to avoid N+1 queries
 */
async function fetchPostsRelations(ctx: any, postIds: string[]) {
  if (postIds.length === 0) return {};

  const catSelect = {
    postId: blogPostCategories.postId,
    id: blogCategories.id,
    slug: blogCategories.slug,
    name: blogCategories.name,
  };
  const tagSelect = {
    postId: blogPostTags.postId,
    id: blogTags.id,
    slug: blogTags.slug,
    name: blogTags.name,
  };

  const [allCategories, allTags] = await Promise.all([
    ctx.db
      .select(catSelect)
      .from(blogPostCategories)
      .innerJoin(blogCategories, eq(blogPostCategories.categoryId, blogCategories.id))
      .where(inArray(blogPostCategories.postId, postIds)),
    ctx.db
      .select(tagSelect)
      .from(blogPostTags)
      .innerJoin(blogTags, eq(blogPostTags.tagId, blogTags.id))
      .where(inArray(blogPostTags.postId, postIds)),
  ]);

  // Group by postId
  const relationsMap: Record<string, { categories: any[]; tags: any[] }> = {};
  postIds.forEach((id) => {
    relationsMap[id] = { categories: [], tags: [] };
  });

  allCategories.forEach((cat) => {
    if (relationsMap[cat.postId]) {
      relationsMap[cat.postId].categories.push({ id: cat.id, slug: cat.slug, name: cat.name });
    }
  });

  allTags.forEach((tag) => {
    if (relationsMap[tag.postId]) {
      relationsMap[tag.postId].tags.push({ id: tag.id, slug: tag.slug, name: tag.name });
    }
  });

  return relationsMap;
}

export const blogPostsRouter = router({
  /**
   * Get paginated list of published posts (PUBLIC)
   */
  list: publicProcedure.input(blogListQuerySchema).query(async ({ input, ctx }) => {
    const { page, pageSize, category, tag, search } = input;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [eq(blogPosts.status, 'published'), lte(blogPosts.publishedAt, new Date())];

    if (search) {
      const sanitized = search.replace(/[%_]/g, '').trim();
      if (sanitized) {
        conditions.push(or(ilike(blogPosts.title, `%${sanitized}%`), ilike(blogPosts.summary, `%${sanitized}%`))!);
      }
    }

    // ⚡ Bolt: Move category and tag filtering to the database to avoid over-fetching
    // and incorrect pagination results when filtering by taxonomy.
    if (category) {
      conditions.push(
        exists(
          ctx.db
            .select({ one: sql`1` })
            .from(blogPostCategories)
            .innerJoin(blogCategories, eq(blogPostCategories.categoryId, blogCategories.id))
            .where(
              and(
                eq(blogPostCategories.postId, blogPosts.id),
                eq(blogCategories.slug, category)
              )
            )
        )
      );
    }

    if (tag) {
      conditions.push(
        exists(
          ctx.db
            .select({ one: sql`1` })
            .from(blogPostTags)
            .innerJoin(blogTags, eq(blogPostTags.tagId, blogTags.id))
            .where(
              and(
                eq(blogPostTags.postId, blogPosts.id),
                eq(blogTags.slug, tag)
              )
            )
        )
      );
    }

    const postSelect = {
      id: blogPosts.id,
      slug: blogPosts.slug,
      title: blogPosts.title,
      summary: blogPosts.summary,
      featuredImageUrl: blogPosts.featuredImageUrl,
      status: blogPosts.status,
      publishedAt: blogPosts.publishedAt,
      createdAt: blogPosts.createdAt,
      authorId: blogPosts.authorId,
    };

    // ⚡ Bolt: Combine data retrieval and total count into a single round-trip using window function count(*) OVER().
    const posts = await ctx.db
      .select({
        ...postSelect,
        totalCount: sql<number>`count(*)::int OVER()`,
      })
      .from(blogPosts)
      .where(and(...conditions))
      .orderBy(desc(blogPosts.publishedAt))
      .limit(pageSize)
      .offset(offset);

    const total = posts[0]?.totalCount || 0;

    // Fetch all relations in batch to avoid N+1 problem
    const postIds = posts.map((post) => post.id);
    const relationsMap = await fetchPostsRelations(ctx, postIds);

    const postsWithRelations = posts.map((post) => ({
      ...post,
      ...relationsMap[post.id],
    }));

    return {
      data: postsWithRelations,
      meta: { page, pageSize, total },
    };
  }),

  /**
   * Get single post by slug (PUBLIC)
   */
  getBySlug: publicProcedure.input(z.object({ slug: z.string().min(1) })).query(async ({ input, ctx }) => {
    // ⚡ Bolt: COLLAPSED 3 QUERIES INTO 1.
    // Use a single relational query to fetch post, author, categories, and tags in one round-trip.
    const post = await ctx.db.query.blogPosts.findFirst({
      where: and(eq(blogPosts.slug, input.slug), eq(blogPosts.status, 'published')),
      with: {
        author: true,
        categories: {
          with: {
            category: {
              columns: { id: true, slug: true, name: true },
            },
          },
        },
        tags: {
          with: {
            tag: {
              columns: { id: true, slug: true, name: true },
            },
          },
        },
      },
    });

    if (!post) throw new TRPCError({ code: 'NOT_FOUND', message: 'Blog post not found' });

    // Flatten relations to match expected frontend structure and API contract
    return {
      ...post,
      categories: post.categories.map((pc: any) => pc.category).filter(Boolean),
      tags: post.tags.map((pt: any) => pt.tag).filter(Boolean),
    };
  }),

  /**
   * Create new blog post (PROTECTED)
   */
  create: protectedProcedure.input(blogPostInputSchema).mutation(async ({ input, ctx }) => {
    const { categoryIds, tagIds, ...postData } = input;
    const authorId = await resolveAuthorId(ctx, input.authorId);
    const statusFields = normalizeStatusFields(input.status || 'draft', input.scheduledFor, input.publishedAt);

    const [post] = await ctx.db
      .insert(blogPosts)
      .values({ ...postData, ...statusFields, authorId, seoKeywords: input.seoKeywords || [], metadata: input.metadata || {} })
      .returning();

    if (!post) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create post' });

    // ⚡ Bolt: Parallelize category and tag synchronization using syncPostRelations helper.
    // This reduces sequential database round-trips from O(4) to O(2) for taxonomy.
    await syncPostRelations(ctx, post.id, categoryIds, tagIds);

    return post;
  }),

  /**
   * Update blog post (PROTECTED)
   */
  update: protectedProcedure
    .input(z.object({ id: z.string().uuid(), updates: blogPostUpdateSchema }))
    .mutation(async ({ input, ctx }) => {
      const { id, updates } = input;
      const { categoryIds, tagIds, ...postUpdates } = updates;

      const [existingPost] = await ctx.db
        .select({ id: blogPosts.id, authorId: blogPosts.authorId })
        .from(blogPosts)
        .where(eq(blogPosts.id, id))
        .limit(1);

      if (!existingPost) throw new TRPCError({ code: 'NOT_FOUND', message: 'Blog post not found' });

      const { canManage, userAuthorId, isAdmin } = await canManagePost(
        ctx,
        id,
        existingPost.authorId,
      );
      if (!canManage) {
        // Mask unauthorized access as not found to avoid disclosing post existence.
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Blog post not found' });
      }

      if (postUpdates.authorId !== undefined) {
        if (!isAdmin) {
          if (postUpdates.authorId !== existingPost.authorId) {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: 'Only admins can reassign post authors',
            });
          }

          // Ignore no-op author updates from non-admin clients.
          delete (postUpdates as any).authorId;
        } else {
          const [targetAuthor] = await ctx.db
            .select({ id: blogAuthors.id })
            .from(blogAuthors)
            .where(eq(blogAuthors.id, postUpdates.authorId))
            .limit(1);

          if (!targetAuthor) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Author not found',
            });
          }
        }
      }

      const updatePayload: any = { ...postUpdates, updatedAt: new Date() };
      if (updates.status) {
        Object.assign(
          updatePayload,
          normalizeStatusFields(updates.status, updates.scheduledFor, updates.publishedAt),
        );
      }

      // 🛡️ Sentinel: Atomic update with ownership check (author or admin) in WHERE clause.
      const [updatedPost] = await ctx.db
        .update(blogPosts)
        .set(updatePayload)
        .where(
          and(
            eq(blogPosts.id, id),
            userAuthorId && !isAdmin ? eq(blogPosts.authorId, userAuthorId) : undefined,
          ),
        )
        .returning();

      if (!updatedPost) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Blog post not found' });
      }

      // ⚡ Bolt: Parallelize category and tag synchronization using syncPostRelations helper.
      // This reduces sequential database round-trips from O(4) to O(2) for taxonomy.
      await syncPostRelations(ctx, id, categoryIds, tagIds, userAuthorId, isAdmin);

      return updatedPost;
    }),

  /**
   * Delete blog post (PROTECTED)
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const [existingPost] = await ctx.db
        .select({ id: blogPosts.id, authorId: blogPosts.authorId })
        .from(blogPosts)
        .where(eq(blogPosts.id, input.id))
        .limit(1);

      if (!existingPost) throw new TRPCError({ code: 'NOT_FOUND', message: 'Blog post not found' });

      const { canManage, userAuthorId, isAdmin } = await canManagePost(
        ctx,
        input.id,
        existingPost.authorId,
      );
      if (!canManage) {
        // Mask unauthorized access as not found to avoid disclosing post existence.
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Blog post not found' });
      }

      // 🛡️ Sentinel: Atomic delete with ownership check in WHERE clause.
      const [deleted] = await ctx.db
        .delete(blogPosts)
        .where(
          and(
            eq(blogPosts.id, input.id),
            userAuthorId && !isAdmin ? eq(blogPosts.authorId, userAuthorId) : undefined,
          ),
        )
        .returning();

      if (!deleted) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Blog post not found' });
      }

      return { success: true };
    }),
});
