/**
 * Blog Routes for Elysia
 *
 * Provides blog API endpoints for posts, categories, tags, and media.
 * Ported from /server/src/routes/v1/blog.ts
 */

import { Elysia } from 'elysia';
import { supabaseService } from '../../lib/supabase.js';
import { authenticateRequest } from '../../lib/auth.js';
import { planRateLimit } from '../../middleware/rate-limit.js';
import { getBlogRole, canManagePost, type BlogRole } from '../../middleware/blog-author.js';
import { mapBlogCategory, mapBlogPost, mapBlogTag } from './blog/mappers.js';
import type { BlogPostRow, BlogCategoryRow, BlogTagRow, BlogCategory, BlogTag } from './blog/types.js';
import {
  blogCategorySchema,
  blogCategoryUpdateSchema,
  blogListQuerySchema,
  blogMediaRequestSchema,
  blogPostInputSchema,
  blogPostPublishSchema,
  blogPostScheduleSchema,
  blogPostUpdateSchema,
  blogSlugCheckSchema,
  blogTagSchema,
  blogTagUpdateSchema,
} from './blog/schemas.js';
import {
  handleValidationError,
  syncPostRelations,
  slugNotFoundError,
  ensureAuthorExists,
  resolveAuthorIdForRequest,
  normalizeSeoKeywords,
  normalizeMetadata,
  normalizeStatusPayload,
  BLOG_POST_SELECT,
  BLOG_POST_SUMMARY_SELECT,
} from './blog/helpers.js';

export const blogApiRoutes = new Elysia({ prefix: '/v1/blog' })
  .use(planRateLimit('default'))

  // ===== PUBLIC ENDPOINTS =====

  /**
   * GET /v1/blog/posts - List published blog posts
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
      let dbQuery = supabaseService
        .from('blog_posts')
        .select(BLOG_POST_SUMMARY_SELECT, { count: 'exact' })
        .eq('status', 'published')
        .lte('published_at', new Date().toISOString());

      if (search) {
        const sanitized = search.replace(/[%_]/g, '').trim();
        if (sanitized.length > 0) {
          dbQuery = dbQuery.or(`title.ilike.%${sanitized}%,summary.ilike.%${sanitized}%`);
        }
      }

      const { data, error, count } = await dbQuery
        .order('published_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .range(rangeStart, rangeEnd);

      if (error) throw error;

      const mapped = (data ?? []).map((row) => mapBlogPost(row as unknown as BlogPostRow, { includeContent: false }));
      const filtered = mapped.filter((post) => {
        const categoryOk = !category || post.categories.some((c) => c.slug === category || c.id === category);
        const tagOk = !tag || post.tags.some((t) => t.slug === tag || t.id === tag);
        return categoryOk && tagOk;
      });

      return {
        data: filtered,
        meta: {
          page,
          pageSize,
          total: category || tag ? filtered.length : count ?? filtered.length,
        },
      };
    } catch (error) {
      set.status = 500;
      return { error: 'Failed to fetch blog posts' };
    }
  })

  /**
   * GET /v1/blog/posts/:postId - Get a single published post by slug or id
   */
  .get('/posts/:postId', async ({ params, set }) => {
    const { postId } = params;
    if (!postId) {
      set.status = 400;
      return { error: 'Missing post identifier' };
    }

    try {
      // Check if postId is a UUID (id) or a slug
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(postId);

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
    } catch (error) {
      set.status = 500;
      return { error: 'Failed to fetch blog post' };
    }
  })

  /**
   * GET /v1/blog/categories - List all categories
   */
  .get('/categories', async ({ set }) => {
    try {
      const { data, error } = await supabaseService
        .from('blog_categories')
        .select('*')
        .order('name', { ascending: true });
      if (error) throw error;
      const categories = (data ?? [])
        .map((row) => mapBlogCategory(row as BlogCategoryRow))
        .filter((value): value is BlogCategory => Boolean(value));
      return categories;
    } catch (error) {
      set.status = 500;
      return { error: 'Failed to fetch categories' };
    }
  })

  /**
   * GET /v1/blog/tags - List all tags
   */
  .get('/tags', async ({ set }) => {
    try {
      const { data, error } = await supabaseService
        .from('blog_tags')
        .select('*')
        .order('name', { ascending: true });
      if (error) throw error;
      const tags = (data ?? [])
        .map((row) => mapBlogTag(row as BlogTagRow))
        .filter((value): value is BlogTag => Boolean(value));
      return tags;
    } catch (error) {
      set.status = 500;
      return { error: 'Failed to fetch tags' };
    }
  })

  // ===== AUTHENTICATED AUTHOR ENDPOINTS =====

  /**
   * POST /v1/blog/posts - Create a new blog post
   */
  .post('/posts', async ({ request, body, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const blogRole = await getBlogRole(user.userId);
    if (blogRole === 'viewer') {
      set.status = 403;
      return { error: 'Blog author or admin access required' };
    }

    const parsed = blogPostInputSchema.safeParse(body ?? {});
    if (!parsed.success) {
      set.status = 400;
      return handleValidationError(parsed.error);
    }

    const payload = parsed.data;
    const status = payload.status ?? 'draft';

    try {
      const authorId = await resolveAuthorIdForRequest(user.userId, blogRole, payload.authorId ?? null);
      const statusFields = normalizeStatusPayload(status, payload.scheduledFor, payload.publishedAt);

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
        if ((insertError as any)?.code === '23505') {
          set.status = 409;
          return { error: 'Slug already exists' };
        }
        if ((insertError as any)?.code === '23503') {
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
   * PUT /v1/blog/posts/:postId - Update a blog post
   */
  .put('/posts/:postId', async ({ request, body, params, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const blogRole = await getBlogRole(user.userId);
    if (blogRole === 'viewer') {
      set.status = 403;
      return { error: 'Blog author or admin access required' };
    }

    const parsed = blogPostUpdateSchema.safeParse(body ?? {});
    if (!parsed.success) {
      set.status = 400;
      return handleValidationError(parsed.error);
    }

    const payload = parsed.data;
    const { id } = params;

    try {
      const canManage = await canManagePost(id || '', user.userId);
      if (!canManage) {
        set.status = 403;
        return { error: 'You do not have permission to update this post' };
      }

      const updatePayload: Record<string, unknown> = {};

      if (payload.title !== undefined) updatePayload.title = payload.title;
      if (payload.slug !== undefined) updatePayload.slug = payload.slug;
      if (payload.summary !== undefined) updatePayload.summary = payload.summary ?? null;
      if (payload.content !== undefined) updatePayload.content = payload.content ?? null;
      if (payload.featuredImageUrl !== undefined) updatePayload.featured_image_url = payload.featuredImageUrl ?? null;
      if (payload.heroImageAlt !== undefined) updatePayload.hero_image_alt = payload.heroImageAlt ?? null;
      if (payload.seoTitle !== undefined) updatePayload.seo_title = payload.seoTitle ?? null;
      if (payload.seoDescription !== undefined) updatePayload.seo_description = payload.seoDescription ?? null;
      if (payload.seoKeywords !== undefined) updatePayload.seo_keywords = normalizeSeoKeywords(payload.seoKeywords);
      if (payload.canonicalUrl !== undefined) updatePayload.canonical_url = payload.canonicalUrl ?? null;
      if (payload.metadata !== undefined) updatePayload.metadata = normalizeMetadata(payload.metadata);

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
        const statusFields = normalizeStatusPayload(payload.status, payload.scheduledFor, payload.publishedAt);
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
        const { error: updateError } = await supabaseService
          .from('blog_posts')
          .update(updatePayload)
          .eq('id', id)
          .select('id')
          .single();

        if (updateError) {
          if ((updateError as any)?.code === '23505') {
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
        await syncPostRelations(id || '', payload.categoryIds, payload.tagIds);
      }

      const { data, error } = await supabaseService
        .from('blog_posts')
        .select(BLOG_POST_SELECT)
        .eq('id', id)
        .single();

      if (error || !data) {
        if (slugNotFoundError(error)) {
          set.status = 404;
          return { error: 'Blog post not found' };
        }
        throw error;
      }

      return mapBlogPost(data as unknown as BlogPostRow);
    } catch (error) {
      if (error instanceof Error && error.message === 'BLOG_AUTHOR_NOT_FOUND') {
        set.status = 400;
        return { error: 'Author not found' };
      }
      set.status = 500;
      return { error: 'Failed to update blog post' };
    }
  })

  /**
   * POST /v1/blog/posts/:postId/publish - Publish a blog post
   */
  .post('/posts/:postId/publish', async ({ request, body, params, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const blogRole = await getBlogRole(user.userId);
    if (blogRole === 'viewer') {
      set.status = 403;
      return { error: 'Blog author or admin access required' };
    }

    const parsed = blogPostPublishSchema.safeParse(body ?? {});
    if (!parsed.success) {
      set.status = 400;
      return handleValidationError(parsed.error);
    }

    const publishTimestamp = parsed.data.publishedAt ?? new Date().toISOString();
    const { id } = params;

    try {
      const canManage = await canManagePost(id || '', user.userId);
      if (!canManage) {
        set.status = 403;
        return { error: 'You do not have permission to publish this post' };
      }

      const statusFields = normalizeStatusPayload('published', null, publishTimestamp);

      const { data, error } = await supabaseService
        .from('blog_posts')
        .update({
          ...statusFields,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select(BLOG_POST_SELECT)
        .single();

      if (error || !data) {
        if (slugNotFoundError(error)) {
          set.status = 404;
          return { error: 'Blog post not found' };
        }
        throw error;
      }

      return mapBlogPost(data as unknown as BlogPostRow);
    } catch (error) {
      set.status = 500;
      return { error: 'Failed to publish blog post' };
    }
  })

  /**
   * DELETE /v1/blog/posts/:postId - Delete a blog post
   */
  .delete('/posts/:postId', async ({ request, params, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const blogRole = await getBlogRole(user.userId);
    if (blogRole === 'viewer') {
      set.status = 403;
      return { error: 'Blog author or admin access required' };
    }

    const { postId: id } = params;

    try {
      const canManage = await canManagePost(id || '', user.userId);
      if (!canManage) {
        set.status = 403;
        return { error: 'You do not have permission to delete this post' };
      }

      const { error: categoryJoinError } = await supabaseService
        .from('blog_post_categories')
        .delete()
        .eq('post_id', id);
      if (categoryJoinError) throw categoryJoinError;

      const { error: tagJoinError } = await supabaseService
        .from('blog_post_tags')
        .delete()
        .eq('post_id', id);
      if (tagJoinError) throw tagJoinError;

      const { error } = await supabaseService
        .from('blog_posts')
        .delete()
        .eq('id', id)
        .select('id')
        .single();

      if (error) {
        if (slugNotFoundError(error)) {
          set.status = 404;
          return { error: 'Blog post not found' };
        }
        throw error;
      }

      set.status = 204;
      return null;
    } catch (error) {
      set.status = 500;
      return { error: 'Failed to delete blog post' };
    }
  })

  // ===== ADMIN ENDPOINTS =====

  /**
   * POST /v1/blog/categories - Create a category (admin only)
   */
  .post('/categories', async ({ request, body, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const blogRole = await getBlogRole(user.userId);
    if (blogRole !== 'admin') {
      set.status = 403;
      return { error: 'Blog admin access required' };
    }

    const parsed = blogCategorySchema.safeParse(body ?? {});
    if (!parsed.success) {
      set.status = 400;
      return handleValidationError(parsed.error);
    }

    const payload = parsed.data;

    try {
      const { data, error } = await supabaseService
        .from('blog_categories')
        .insert({
          name: payload.name,
          slug: payload.slug,
          description: payload.description ?? null,
        })
        .select('*')
        .single();

      if (error || !data) {
        if ((error as any)?.code === '23505') {
          set.status = 409;
          return { error: 'Category slug already exists' };
        }
        throw error;
      }

      set.status = 201;
      return mapBlogCategory(data as BlogCategoryRow);
    } catch (error) {
      set.status = 500;
      return { error: 'Failed to create category' };
    }
  })

  /**
   * PUT /v1/blog/categories/:id - Update a category (admin only)
   */
  .put('/categories/:id', async ({ request, body, params, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const blogRole = await getBlogRole(user.userId);
    if (blogRole !== 'admin') {
      set.status = 403;
      return { error: 'Blog admin access required' };
    }

    const parsed = blogCategoryUpdateSchema.safeParse(body ?? {});
    if (!parsed.success) {
      set.status = 400;
      return handleValidationError(parsed.error);
    }

    const payload = parsed.data;
    const { id } = params;

    if (Object.keys(payload).length === 0) {
      set.status = 400;
      return { error: 'Nothing to update' };
    }

    const updatePayload: Record<string, unknown> = {};
    if (payload.name !== undefined) updatePayload.name = payload.name;
    if (payload.slug !== undefined) updatePayload.slug = payload.slug;
    if (payload.description !== undefined) updatePayload.description = payload.description ?? null;

    try {
      const { data, error } = await supabaseService
        .from('blog_categories')
        .update(updatePayload)
        .eq('id', id)
        .select('*')
        .single();

      if (error || !data) {
        if (slugNotFoundError(error)) {
          set.status = 404;
          return { error: 'Category not found' };
        }
        if ((error as any)?.code === '23505') {
          set.status = 409;
          return { error: 'Category slug already exists' };
        }
        throw error;
      }

      return mapBlogCategory(data as BlogCategoryRow);
    } catch (error) {
      set.status = 500;
      return { error: 'Failed to update category' };
    }
  })

  /**
   * DELETE /v1/blog/categories/:id - Delete a category (admin only)
   */
  .delete('/categories/:id', async ({ request, params, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const blogRole = await getBlogRole(user.userId);
    if (blogRole !== 'admin') {
      set.status = 403;
      return { error: 'Blog admin access required' };
    }

    const { id } = params;

    try {
      const { error: joinDeleteError } = await supabaseService
        .from('blog_post_categories')
        .delete()
        .eq('category_id', id);
      if (joinDeleteError) throw joinDeleteError;

      const { error } = await supabaseService
        .from('blog_categories')
        .delete()
        .eq('id', id)
        .select('id')
        .single();

      if (error) {
        if (slugNotFoundError(error)) {
          set.status = 404;
          return { error: 'Category not found' };
        }
        throw error;
      }

      set.status = 204;
      return null;
    } catch (error) {
      set.status = 500;
      return { error: 'Failed to delete category' };
    }
  })

  /**
   * POST /v1/blog/tags - Create a tag (admin only)
   */
  .post('/tags', async ({ request, body, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const blogRole = await getBlogRole(user.userId);
    if (blogRole !== 'admin') {
      set.status = 403;
      return { error: 'Blog admin access required' };
    }

    const parsed = blogTagSchema.safeParse(body ?? {});
    if (!parsed.success) {
      set.status = 400;
      return handleValidationError(parsed.error);
    }

    const payload = parsed.data;

    try {
      const { data, error } = await supabaseService
        .from('blog_tags')
        .insert({
          name: payload.name,
          slug: payload.slug,
          description: payload.description ?? null,
        })
        .select('*')
        .single();

      if (error || !data) {
        if ((error as any)?.code === '23505') {
          set.status = 409;
          return { error: 'Tag slug already exists' };
        }
        throw error;
      }

      set.status = 201;
      return mapBlogTag(data as BlogTagRow);
    } catch (error) {
      set.status = 500;
      return { error: 'Failed to create tag' };
    }
  })

  /**
   * PUT /v1/blog/tags/:id - Update a tag (admin only)
   */
  .put('/tags/:id', async ({ request, body, params, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const blogRole = await getBlogRole(user.userId);
    if (blogRole !== 'admin') {
      set.status = 403;
      return { error: 'Blog admin access required' };
    }

    const parsed = blogTagUpdateSchema.safeParse(body ?? {});
    if (!parsed.success) {
      set.status = 400;
      return handleValidationError(parsed.error);
    }

    const payload = parsed.data;
    const { id } = params;

    if (Object.keys(payload).length === 0) {
      set.status = 400;
      return { error: 'Nothing to update' };
    }

    const updatePayload: Record<string, unknown> = {};
    if (payload.name !== undefined) updatePayload.name = payload.name;
    if (payload.slug !== undefined) updatePayload.slug = payload.slug;
    if (payload.description !== undefined) updatePayload.description = payload.description ?? null;

    try {
      const { data, error } = await supabaseService
        .from('blog_tags')
        .update(updatePayload)
        .eq('id', id)
        .select('*')
        .single();

      if (error || !data) {
        if (slugNotFoundError(error)) {
          set.status = 404;
          return { error: 'Tag not found' };
        }
        if ((error as any)?.code === '23505') {
          set.status = 409;
          return { error: 'Tag slug already exists' };
        }
        throw error;
      }

      return mapBlogTag(data as BlogTagRow);
    } catch (error) {
      set.status = 500;
      return { error: 'Failed to update tag' };
    }
  })

  /**
   * DELETE /v1/blog/tags/:id - Delete a tag (admin only)
   */
  .delete('/tags/:id', async ({ request, params, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const blogRole = await getBlogRole(user.userId);
    if (blogRole !== 'admin') {
      set.status = 403;
      return { error: 'Blog admin access required' };
    }

    const { id } = params;

    try {
      const { error: joinDeleteError } = await supabaseService
        .from('blog_post_tags')
        .delete()
        .eq('tag_id', id);
      if (joinDeleteError) throw joinDeleteError;

      const { error } = await supabaseService
        .from('blog_tags')
        .delete()
        .eq('id', id)
        .select('id')
        .single();

      if (error) {
        if (slugNotFoundError(error)) {
          set.status = 404;
          return { error: 'Tag not found' };
        }
        throw error;
      }

      set.status = 204;
      return null;
    } catch (error) {
      set.status = 500;
      return { error: 'Failed to delete tag' };
    }
  })

  /**
   * POST /v1/blog/media/sign-upload - Get a signed upload URL (admin only)
   */
  .post('/media/sign-upload', async ({ request, body, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const blogRole = await getBlogRole(user.userId);
    if (blogRole !== 'admin') {
      set.status = 403;
      return { error: 'Blog admin access required' };
    }

    const parsed = blogMediaRequestSchema.safeParse(body ?? {});
    if (!parsed.success) {
      set.status = 400;
      return handleValidationError(parsed.error);
    }

    const { path } = parsed.data;
    const bucket = process.env.BLOG_MEDIA_BUCKET;

    if (!bucket) {
      set.status = 500;
      return { error: 'BLOG_MEDIA_BUCKET is not configured' };
    }

    try {
      const storageBucket = supabaseService.storage.from(bucket);
      const { data, error } = await storageBucket.createSignedUploadUrl(path);

      if (error || !data) {
        throw error;
      }

      return {
        signedUrl: data.signedUrl,
        path: data.path,
        token: data.token,
      };
    } catch (error) {
      set.status = 500;
      return { error: 'Failed to generate upload URL' };
    }
  })

  /**
   * GET /v1/blog/posts/:postId/preview - Preview a post (author/admin)
   */
  .get('/posts/:postId/preview', async ({ request, params, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const blogRole = await getBlogRole(user.userId);
    if (blogRole === 'viewer') {
      set.status = 403;
      return { error: 'Blog author or admin access required' };
    }

    const { postId: id } = params;

    try {
      const canManage = await canManagePost(id || '', user.userId);
      if (!canManage) {
        set.status = 403;
        return { error: 'You do not have permission to preview this post' };
      }

      const { data, error } = await supabaseService
        .from('blog_posts')
        .select(BLOG_POST_SELECT)
        .eq('id', id)
        .single();

      if (error || !data) {
        if (slugNotFoundError(error)) {
          set.status = 404;
          return { error: 'Blog post not found' };
        }
        throw error;
      }

      return mapBlogPost(data as unknown as BlogPostRow, { includeHtml: true });
    } catch (error) {
      set.status = 500;
      return { error: 'Failed to fetch blog post preview' };
    }
  })

  /**
   * GET /v1/blog/admin/posts - List all posts for admin (author/admin)
   */
  .get('/admin/posts', async ({ request, query, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const blogRole = await getBlogRole(user.userId);
    if (blogRole === 'viewer') {
      set.status = 403;
      return { error: 'Blog author or admin access required' };
    }

    const parsed = blogListQuerySchema.safeParse(query);
    if (!parsed.success) {
      set.status = 400;
      return handleValidationError(parsed.error);
    }
    const { page, pageSize, category, tag, search, status, scheduledOnly } = parsed.data;
    const rangeStart = (page - 1) * pageSize;
    const rangeEnd = rangeStart + pageSize - 1;

    try {
      let dbQuery = supabaseService
        .from('blog_posts')
        .select(BLOG_POST_SUMMARY_SELECT, { count: 'exact' });

      if (status) {
        dbQuery = dbQuery.eq('status', status);
      }

      if (scheduledOnly) {
        dbQuery = dbQuery.not('scheduled_for', 'is', null);
      }

      if (search) {
        const sanitized = search.replace(/[%_]/g, '').trim();
        if (sanitized.length > 0) {
          dbQuery = dbQuery.or(`title.ilike.%${sanitized}%,summary.ilike.%${sanitized}%`);
        }
      }

      if (blogRole !== 'admin') {
        const { data: authorData } = await supabaseService
          .from('blog_authors')
          .select('id')
          .eq('user_id', user.userId)
          .maybeSingle();

        if (authorData) {
          dbQuery = dbQuery.eq('author_id', authorData.id);
        } else {
          return { data: [], meta: { page, pageSize, total: 0 } };
        }
      }

      const { data, error, count } = await dbQuery
        .order('updated_at', { ascending: false })
        .range(rangeStart, rangeEnd);

      if (error) throw error;

      const mapped = (data ?? []).map((row) => mapBlogPost(row as unknown as BlogPostRow, { includeContent: false }));
      const filtered = mapped.filter((post) => {
        const categoryOk = !category || post.categories.some((c) => c.slug === category || c.id === category);
        const tagOk = !tag || post.tags.some((t) => t.slug === tag || t.id === tag);
        return categoryOk && tagOk;
      });

      return {
        data: filtered,
        meta: {
          page,
          pageSize,
          total: category || tag ? filtered.length : count ?? filtered.length,
        },
      };
    } catch (error) {
      set.status = 500;
      return { error: 'Failed to fetch blog posts' };
    }
  })

  /**
   * POST /v1/blog/posts/:postId/request-review - Request review (author/admin)
   */
  .post('/posts/:postId/request-review', async ({ request, params, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const blogRole = await getBlogRole(user.userId);
    if (blogRole === 'viewer') {
      set.status = 403;
      return { error: 'Blog author or admin access required' };
    }

    const { postId: id } = params;

    try {
      const canManage = await canManagePost(id || '', user.userId);
      if (!canManage) {
        set.status = 403;
        return { error: 'You do not have permission to update this post' };
      }

      const { data, error } = await supabaseService
        .from('blog_posts')
        .update({
          status: 'review',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select(BLOG_POST_SELECT)
        .single();

      if (error || !data) {
        if (slugNotFoundError(error)) {
          set.status = 404;
          return { error: 'Blog post not found' };
        }
        throw error;
      }

      return mapBlogPost(data as unknown as BlogPostRow);
    } catch (error) {
      set.status = 500;
      return { error: 'Failed to request review for blog post' };
    }
  })

  /**
   * POST /v1/blog/posts/:postId/schedule - Schedule a post (author/admin)
   */
  .post('/posts/:postId/schedule', async ({ request, body, params, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const blogRole = await getBlogRole(user.userId);
    if (blogRole === 'viewer') {
      set.status = 403;
      return { error: 'Blog author or admin access required' };
    }

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
        set.status = 403;
        return { error: 'You do not have permission to update this post' };
      }

      const { data, error } = await supabaseService
        .from('blog_posts')
        .update({
          status: 'scheduled',
          scheduled_for: scheduledFor,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select(BLOG_POST_SELECT)
        .single();

      if (error || !data) {
        if (slugNotFoundError(error)) {
          set.status = 404;
          return { error: 'Blog post not found' };
        }
        throw error;
      }

      return mapBlogPost(data as unknown as BlogPostRow);
    } catch (error) {
      set.status = 500;
      return { error: 'Failed to schedule blog post' };
    }
  })

  /**
   * POST /v1/blog/posts/:postId/archive - Archive a post (author/admin)
   */
  .post('/posts/:postId/archive', async ({ request, params, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const blogRole = await getBlogRole(user.userId);
    if (blogRole === 'viewer') {
      set.status = 403;
      return { error: 'Blog author or admin access required' };
    }

    const { postId: id } = params;

    try {
      const canManage = await canManagePost(id || '', user.userId);
      if (!canManage) {
        set.status = 403;
        return { error: 'You do not have permission to update this post' };
      }

      const { data, error } = await supabaseService
        .from('blog_posts')
        .update({
          status: 'archived',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select(BLOG_POST_SELECT)
        .single();

      if (error || !data) {
        if (slugNotFoundError(error)) {
          set.status = 404;
          return { error: 'Blog post not found' };
        }
        throw error;
      }

      return mapBlogPost(data as unknown as BlogPostRow);
    } catch (error) {
      set.status = 500;
      return { error: 'Failed to archive blog post' };
    }
  })

  /**
   * POST /v1/blog/slug/check - Check if a slug is available (author/admin)
   */
  .post('/slug/check', async ({ request, body, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const blogRole = await getBlogRole(user.userId);
    if (blogRole === 'viewer') {
      set.status = 403;
      return { error: 'Blog author or admin access required' };
    }

    const parsed = blogSlugCheckSchema.safeParse(body ?? {});
    if (!parsed.success) {
      set.status = 400;
      return handleValidationError(parsed.error);
    }

    const { slug, excludeId } = parsed.data;

    try {
      let dbQuery = supabaseService
        .from('blog_posts')
        .select('id')
        .eq('slug', slug);

      if (excludeId) {
        dbQuery = dbQuery.neq('id', excludeId);
      }

      const { data, error } = await dbQuery.maybeSingle();

      if (error) throw error;

      return {
        available: !data,
        slug,
      };
    } catch (error) {
      set.status = 500;
      return { error: 'Failed to check slug availability' };
    }
  });
