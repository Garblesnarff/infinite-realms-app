/**
 * Blog Post Routes
 *
 * CRUD operations for blog posts:
 * - GET /posts - List published posts (public)
 * - GET /posts/:postId - Get single published post (public)
 * - POST /posts - Create a new post (author/admin)
 * - PUT /posts/:postId - Update a post (author/admin)
 * - DELETE /posts/:postId - Delete a post (author/admin)
 */

import { Elysia } from 'elysia';

import {
  handleValidationError,
  syncPostRelations,
  deletePostRelations,
  slugNotFoundError,
  isUuid,
  ensureAuthorExists,
  resolveAuthorIdForRequest,
  normalizeSeoKeywords,
  normalizeMetadata,
  normalizeStatusPayload,
  requireBlogAuth,
  getAuthorScopeIdForMutation,
  BLOG_POST_SELECT,
  BLOG_POST_SUMMARY_SELECT,
} from './helpers.js';
import { mapBlogPost } from './mappers.js';
import { blogListQuerySchema, blogPostInputSchema, blogPostUpdateSchema } from './schemas.js';
import { supabaseService } from '../../../lib/supabase.js';
import { canManagePost } from '../../../middleware/blog-author.js';

import type { BlogPostRow } from './types.js';

export const blogPostRoutes = new Elysia()

  /**
   * GET /posts - List published blog posts
   */
  .get('/posts', async ({ query, set }) => {
    const parsed = blogListQuerySchema.safeParse(query);
    if (!parsed.success) {
      set.status = 400;
      return handleValidationError(parsed.error);
    }
    const { page, pageSize, category, tag, search } = parsed.data;
    const rangeStart = (page - 1) * pageSize;
    const rangeEnd = rangeStart + pageSize - 1;

    try {
      // ⚡ Bolt: Dynamically inject !inner joins for taxonomy filtering to perform
      // intersection at the database level instead of in-memory.
      let selectString = BLOG_POST_SUMMARY_SELECT;
      if (category) {
        selectString = selectString
          .replace(/categories:blog_post_categories\s*\(/, 'categories:blog_post_categories!inner (')
          .replace(/category:blog_categories\s*\(/, 'category:blog_categories!inner (');
      }
      if (tag) {
        selectString = selectString
          .replace(/tags:blog_post_tags\s*\(/, 'tags:blog_post_tags!inner (')
          .replace(/tag:blog_tags\s*\(/, 'tag:blog_tags!inner (');
      }

      let dbQuery = supabaseService
        .from('blog_posts')
        .select(selectString, { count: 'exact' })
        .eq('status', 'published')
        .lte('published_at', new Date().toISOString());

      if (category) {
        if (isUuid(category)) {
          dbQuery = dbQuery.eq('categories.category_id', category);
        } else {
          dbQuery = dbQuery.eq('categories.category.slug', category);
        }
      }

      if (tag) {
        if (isUuid(tag)) {
          dbQuery = dbQuery.eq('tags.tag_id', tag);
        } else {
          dbQuery = dbQuery.eq('tags.tag.slug', tag);
        }
      }

      if (search) {
        const sanitized = search.trim().toLowerCase();
        if (sanitized.length > 0) {
          dbQuery = dbQuery.or(`title.ilike.%${sanitized}%,summary.ilike.%${sanitized}%`);
        }
      }

      const { data, error, count } = await dbQuery
        .order('published_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .range(rangeStart, rangeEnd);

      if (error) throw error;

      const mapped = (data ?? []).map((row) =>
        mapBlogPost(row as unknown as BlogPostRow, { includeContent: false }),
      );

      return {
        data: mapped,
        meta: {
          page,
          pageSize,
          total: count ?? mapped.length,
        },
      };
    } catch (_error) {
      set.status = 500;
      return { error: 'Failed to fetch blog posts' };
    }
  })

  /**
   * GET /posts/:postId - Get a single published post by slug or id
   */
  .get('/posts/:postId', async ({ params, set }) => {
    const { postId } = params;
    if (!postId) {
      set.status = 400;
      return { error: 'Missing post identifier' };
    }

    try {
      // Check if postId is a UUID (id) or a slug
      const isUUID =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(postId);

      let query = supabaseService
        .from('blog_posts')
        .select(BLOG_POST_SELECT)
        .eq('status', 'published');

      if (isUUID) {
        query = query.eq('id', postId);
      } else {
        query = query.eq('slug', postId);
      }

      const { data, error } = await query.single();

      if (error || !data) {
        if (slugNotFoundError(error)) {
          set.status = 404;
          return { error: 'Blog post not found' };
        }
        throw error;
      }

      return mapBlogPost(data as unknown as BlogPostRow, { includeHtml: true });
    } catch (_error) {
      set.status = 500;
      return { error: 'Failed to fetch blog post' };
    }
  })

  /**
   * POST /posts - Create a new blog post
   */
  .post('/posts', async ({ request, body, set }) => {
    const auth = await requireBlogAuth(request);
    if (!auth.authorized) {
      set.status = auth.status;
      return auth.body;
    }
    const { user, blogRole } = auth;

    const parsed = blogPostInputSchema.safeParse(body ?? {});
    if (!parsed.success) {
      set.status = 400;
      return handleValidationError(parsed.error);
    }

    const payload = parsed.data;
    const status = payload.status ?? 'draft';

    try {
      const authorId = await resolveAuthorIdForRequest(
        user.userId,
        blogRole,
        payload.authorId ?? null,
      );
      const statusFields = normalizeStatusPayload(
        status,
        payload.scheduledFor,
        payload.publishedAt,
      );

      const { data: inserted, error: insertError } = await supabaseService
        .from('blog_posts')
        .insert({
          title: payload.title,
          slug: payload.slug,
          summary: payload.summary ?? null,
          content: payload.content ?? null,
          featured_image_url: payload.featuredImageUrl ?? null,
          hero_image_alt: payload.heroImageAlt ?? null,
          seo_title: payload.seoTitle ?? null,
          seo_description: payload.seoDescription ?? null,
          seo_keywords: normalizeSeoKeywords(payload.seoKeywords),
          canonical_url: payload.canonicalUrl ?? null,
          ...statusFields,
          metadata: normalizeMetadata(payload.metadata),
          author_id: authorId,
        })
        .select('id')
        .single();

      if (insertError || !inserted) {
        if (insertError?.code === '23505') {
          set.status = 409;
          return { error: 'Slug already exists' };
        }
        if (insertError?.code === '23503') {
          set.status = 400;
          return { error: 'Invalid author reference' };
        }
        throw insertError;
      }

      await syncPostRelations(inserted.id, payload.categoryIds, payload.tagIds);
      const { data, error } = await supabaseService
        .from('blog_posts')
        .select(BLOG_POST_SELECT)
        .eq('id', inserted.id)
        .single();

      if (error || !data) {
        throw error;
      }

      set.status = 201;
      return mapBlogPost(data as unknown as BlogPostRow);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'BLOG_AUTHOR_NOT_FOUND') {
          set.status = 400;
          return { error: 'Author not found' };
        }
        if (error.message === 'BLOG_AUTHOR_PROFILE_REQUIRED') {
          set.status = 400;
          return { error: 'You must create an author profile before creating posts' };
        }
      }
      set.status = 500;
      return { error: 'Failed to create blog post' };
    }
  })

  /**
   * PUT /posts/:postId - Update a blog post
   */
  .put('/posts/:postId', async ({ request, body, params, set }) => {
    const auth = await requireBlogAuth(request);
    if (!auth.authorized) {
      set.status = auth.status;
      return auth.body;
    }
    const { user, blogRole } = auth;

    const parsed = blogPostUpdateSchema.safeParse(body ?? {});
    if (!parsed.success) {
      set.status = 400;
      return handleValidationError(parsed.error);
    }

    const payload = parsed.data;
    const { postId: id } = params;

    try {
      const canManage = await canManagePost(id || '', user.userId);
      if (!canManage) {
        set.status = 404;
        return { error: 'Blog post not found' };
      }

      const authorScopeId = await getAuthorScopeIdForMutation(blogRole, user.userId);
      if (blogRole !== 'admin' && !authorScopeId) {
        set.status = 404;
        return { error: 'Blog post not found' };
      }

      const updatePayload: Record<string, unknown> = {};

      if (payload.title !== undefined) updatePayload.title = payload.title;
      if (payload.slug !== undefined) updatePayload.slug = payload.slug;
      if (payload.summary !== undefined) updatePayload.summary = payload.summary ?? null;
      if (payload.content !== undefined) updatePayload.content = payload.content ?? null;
      if (payload.featuredImageUrl !== undefined)
        updatePayload.featured_image_url = payload.featuredImageUrl ?? null;
      if (payload.heroImageAlt !== undefined)
        updatePayload.hero_image_alt = payload.heroImageAlt ?? null;
      if (payload.seoTitle !== undefined) updatePayload.seo_title = payload.seoTitle ?? null;
      if (payload.seoDescription !== undefined)
        updatePayload.seo_description = payload.seoDescription ?? null;
      if (payload.seoKeywords !== undefined)
        updatePayload.seo_keywords = normalizeSeoKeywords(payload.seoKeywords);
      if (payload.canonicalUrl !== undefined)
        updatePayload.canonical_url = payload.canonicalUrl ?? null;
      if (payload.metadata !== undefined)
        updatePayload.metadata = normalizeMetadata(payload.metadata);

      if (payload.authorId !== undefined && blogRole === 'admin') {
        if (payload.authorId === null) {
          set.status = 400;
          return { error: 'Author ID cannot be null' };
        }
        const exists = await ensureAuthorExists(payload.authorId);
        if (!exists) {
          set.status = 400;
          return { error: 'Author not found' };
        }
        updatePayload.author_id = payload.authorId;
      }

      if (payload.status !== undefined) {
        if (payload.status === 'scheduled' && !payload.scheduledFor) {
          set.status = 400;
          return { error: 'scheduledFor is required when scheduling a post' };
        }
        const statusFields = normalizeStatusPayload(
          payload.status,
          payload.scheduledFor,
          payload.publishedAt,
        );
        Object.assign(updatePayload, statusFields);
      } else {
        if (payload.scheduledFor !== undefined) {
          updatePayload.scheduled_for = payload.scheduledFor;
        }
        if (payload.publishedAt !== undefined) {
          updatePayload.published_at = payload.publishedAt;
        }
      }

      const hasUpdates = Object.keys(updatePayload).length > 0;

      if (hasUpdates) {
        updatePayload.updated_at = new Date().toISOString();
        let updateQuery = supabaseService.from('blog_posts').update(updatePayload).eq('id', id);
        if (authorScopeId) {
          updateQuery = updateQuery.eq('author_id', authorScopeId);
        }
        const { error: updateError } = await updateQuery.select('id').single();

        if (updateError) {
          if (updateError?.code === '23505') {
            set.status = 409;
            return { error: 'Slug already exists' };
          }
          if (slugNotFoundError(updateError)) {
            set.status = 404;
            return { error: 'Blog post not found' };
          }
          throw updateError;
        }
      }

      if (payload.categoryIds !== undefined || payload.tagIds !== undefined) {
        await syncPostRelations(id || '', payload.categoryIds, payload.tagIds, authorScopeId);
      }

      let fetchQuery = supabaseService.from('blog_posts').select(BLOG_POST_SELECT).eq('id', id);
      if (authorScopeId) {
        fetchQuery = fetchQuery.eq('author_id', authorScopeId);
      }
      const { data, error } = await fetchQuery.single();

      if (error || !data) {
        if (slugNotFoundError(error)) {
          set.status = 404;
          return { error: 'Blog post not found' };
        }
        throw error;
      }

      return mapBlogPost(data as unknown as BlogPostRow);
    } catch (_error) {
      if (error instanceof Error && error.message === 'BLOG_AUTHOR_NOT_FOUND') {
        set.status = 400;
        return { error: 'Author not found' };
      }
      if (error instanceof Error && error.message === 'BLOG_POST_NOT_FOUND') {
        set.status = 404;
        return { error: 'Blog post not found' };
      }
      set.status = 500;
      return { error: 'Failed to update blog post' };
    }
  })

  /**
   * DELETE /posts/:postId - Delete a blog post
   */
  .delete('/posts/:postId', async ({ request, params, set }) => {
    const auth = await requireBlogAuth(request);
    if (!auth.authorized) {
      set.status = auth.status;
      return auth.body;
    }
    const { user, blogRole } = auth;

    const { postId: id } = params;

    try {
      const canManage = await canManagePost(id || '', user.userId);
      if (!canManage) {
        set.status = 404;
        return { error: 'Blog post not found' };
      }

      const authorScopeId = await getAuthorScopeIdForMutation(blogRole, user.userId);
      if (blogRole !== 'admin' && !authorScopeId) {
        set.status = 404;
        return { error: 'Blog post not found' };
      }

      await deletePostRelations(id || '', authorScopeId);

      let deleteQuery = supabaseService.from('blog_posts').delete().eq('id', id);
      if (authorScopeId) {
        deleteQuery = deleteQuery.eq('author_id', authorScopeId);
      }
      const { error } = await deleteQuery.select('id').single();

      if (error) {
        if (slugNotFoundError(error)) {
          set.status = 404;
          return { error: 'Blog post not found' };
        }
        throw error;
      }

      set.status = 204;
      return null;
    } catch (_error) {
      if (error instanceof Error && error.message === 'BLOG_POST_NOT_FOUND') {
        set.status = 404;
        return { error: 'Blog post not found' };
      }
      set.status = 500;
      return { error: 'Failed to delete blog post' };
    }
  });
