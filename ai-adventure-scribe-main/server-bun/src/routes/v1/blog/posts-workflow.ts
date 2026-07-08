/**
 * Blog Post Workflow Routes
 *
 * Status transitions and workflow operations:
 * - POST /posts/:postId/publish - Publish a post
 * - POST /posts/:postId/request-review - Request review
 * - POST /posts/:postId/schedule - Schedule a post
 * - POST /posts/:postId/archive - Archive a post
 * - GET /posts/:postId/preview - Preview a post (any status)
 * - POST /slug/check - Check slug availability
 *
 * @deprecated No frontend callers as of 2026-07-08; retained for built-before-wired workflow tooling.
 */

import { Elysia } from 'elysia';

import {
  handleValidationError,
  slugNotFoundError,
  normalizeStatusPayload,
  requireBlogAuth,
  getAuthorScopeIdForMutation,
  BLOG_POST_SELECT,
} from './helpers.js';
import { mapBlogPost } from './mappers.js';
import { blogPostPublishSchema, blogPostScheduleSchema, blogSlugCheckSchema } from './schemas.js';
import { supabaseService } from '../../../lib/supabase.js';
import { canManagePost } from '../../../middleware/blog-author.js';

import type { BlogPostRow } from './types.js';

export const blogPostWorkflowRoutes = new Elysia()

  /**
   * POST /posts/:postId/publish - Publish a blog post
   */
  .post('/posts/:postId/publish', async ({ request, body, params, set }) => {
    const auth = await requireBlogAuth(request);
    if (!auth.authorized) {
      set.status = auth.status;
      return auth.body;
    }
    const { user, blogRole } = auth;

    const parsed = blogPostPublishSchema.safeParse(body ?? {});
    if (!parsed.success) {
      set.status = 400;
      return handleValidationError(parsed.error);
    }

    const publishTimestamp = parsed.data.publishedAt ?? new Date().toISOString();
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

      const statusFields = normalizeStatusPayload('published', null, publishTimestamp);

      let publishQuery = supabaseService
        .from('blog_posts')
        .update({
          ...statusFields,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (authorScopeId) {
        publishQuery = publishQuery.eq('author_id', authorScopeId);
      }
      const { data, error } = await publishQuery.select(BLOG_POST_SELECT).single();

      if (error || !data) {
        if (slugNotFoundError(error)) {
          set.status = 404;
          return { error: 'Blog post not found' };
        }
        throw error;
      }

      return mapBlogPost(data as unknown as BlogPostRow);
    } catch (_error) {
      set.status = 500;
      return { error: 'Failed to publish blog post' };
    }
  })

  /**
   * POST /posts/:postId/request-review - Request review (author/admin)
   */
  .post('/posts/:postId/request-review', async ({ request, params, set }) => {
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

      let requestReviewQuery = supabaseService
        .from('blog_posts')
        .update({
          status: 'review',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (authorScopeId) {
        requestReviewQuery = requestReviewQuery.eq('author_id', authorScopeId);
      }
      const { data, error } = await requestReviewQuery.select(BLOG_POST_SELECT).single();

      if (error || !data) {
        if (slugNotFoundError(error)) {
          set.status = 404;
          return { error: 'Blog post not found' };
        }
        throw error;
      }

      return mapBlogPost(data as unknown as BlogPostRow);
    } catch (_error) {
      set.status = 500;
      return { error: 'Failed to request review for blog post' };
    }
  })

  /**
   * POST /posts/:postId/schedule - Schedule a post (author/admin)
   */
  .post('/posts/:postId/schedule', async ({ request, body, params, set }) => {
    const auth = await requireBlogAuth(request);
    if (!auth.authorized) {
      set.status = auth.status;
      return auth.body;
    }
    const { user, blogRole } = auth;

    const parsed = blogPostScheduleSchema.safeParse(body ?? {});
    if (!parsed.success) {
      set.status = 400;
      return handleValidationError(parsed.error);
    }

    const { scheduledFor } = parsed.data;
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

      let scheduleQuery = supabaseService
        .from('blog_posts')
        .update({
          status: 'scheduled',
          scheduled_for: scheduledFor,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (authorScopeId) {
        scheduleQuery = scheduleQuery.eq('author_id', authorScopeId);
      }
      const { data, error } = await scheduleQuery.select(BLOG_POST_SELECT).single();

      if (error || !data) {
        if (slugNotFoundError(error)) {
          set.status = 404;
          return { error: 'Blog post not found' };
        }
        throw error;
      }

      return mapBlogPost(data as unknown as BlogPostRow);
    } catch (_error) {
      set.status = 500;
      return { error: 'Failed to schedule blog post' };
    }
  })

  /**
   * POST /posts/:postId/archive - Archive a post (author/admin)
   */
  .post('/posts/:postId/archive', async ({ request, params, set }) => {
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

      let archiveQuery = supabaseService
        .from('blog_posts')
        .update({
          status: 'archived',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (authorScopeId) {
        archiveQuery = archiveQuery.eq('author_id', authorScopeId);
      }
      const { data, error } = await archiveQuery.select(BLOG_POST_SELECT).single();

      if (error || !data) {
        if (slugNotFoundError(error)) {
          set.status = 404;
          return { error: 'Blog post not found' };
        }
        throw error;
      }

      return mapBlogPost(data as unknown as BlogPostRow);
    } catch (_error) {
      set.status = 500;
      return { error: 'Failed to archive blog post' };
    }
  })

  /**
   * GET /posts/:postId/preview - Preview a post (author/admin)
   */
  .get('/posts/:postId/preview', async ({ request, params, set }) => {
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

      let previewQuery = supabaseService.from('blog_posts').select(BLOG_POST_SELECT).eq('id', id);
      if (authorScopeId) {
        previewQuery = previewQuery.eq('author_id', authorScopeId);
      }
      const { data, error } = await previewQuery.single();

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
      return { error: 'Failed to fetch blog post preview' };
    }
  })

  /**
   * POST /slug/check - Check if a slug is available (author/admin)
   */
  .post('/slug/check', async ({ request, body, set }) => {
    const auth = await requireBlogAuth(request);
    if (!auth.authorized) {
      set.status = auth.status;
      return auth.body;
    }

    const parsed = blogSlugCheckSchema.safeParse(body ?? {});
    if (!parsed.success) {
      set.status = 400;
      return handleValidationError(parsed.error);
    }

    const { slug, excludeId } = parsed.data;

    try {
      let dbQuery = supabaseService.from('blog_posts').select('id').eq('slug', slug);

      if (excludeId) {
        dbQuery = dbQuery.neq('id', excludeId);
      }

      const { data, error } = await dbQuery.maybeSingle();

      if (error) throw error;

      return {
        available: !data,
        slug,
      };
    } catch (_error) {
      set.status = 500;
      return { error: 'Failed to check slug availability' };
    }
  });
