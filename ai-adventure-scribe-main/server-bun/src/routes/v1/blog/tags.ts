/**
 * Blog Tag Routes
 *
 * Tag CRUD operations:
 * - GET /tags - List all tags (public)
 * - POST /tags - Create a tag (admin only)
 * - PUT /tags/:id - Update a tag (admin only)
 * - DELETE /tags/:id - Delete a tag (admin only)
 *
 * @deprecated No frontend callers as of 2026-07-08; retained for built-before-wired taxonomy support.
 */

import { Elysia } from 'elysia';

import { handleValidationError, slugNotFoundError, requireBlogAdminAuth } from './helpers.js';
import { mapBlogTag } from './mappers.js';
import { blogTagSchema, blogTagUpdateSchema } from './schemas.js';
import { supabaseService } from '../../../lib/supabase.js';

import type { BlogTagRow, BlogTag } from './types.js';

// Explicit column list to avoid over-fetching
const TAG_COLS = 'id, name, slug, description';

export const blogTagRoutes = new Elysia()

  /**
   * GET /tags - List all tags
   */
  .get('/tags', async ({ set }) => {
    try {
      const { data, error } = await supabaseService
        .from('blog_tags')
        .select(TAG_COLS)
        .order('name', { ascending: true });
      if (error) throw error;
      const tags = (data ?? [])
        .map((row) => mapBlogTag(row as BlogTagRow))
        .filter((value): value is BlogTag => Boolean(value));
      return tags;
    } catch (_error) {
      set.status = 500;
      return { error: 'Failed to fetch tags' };
    }
  })

  /**
   * POST /tags - Create a tag (admin only)
   */
  .post('/tags', async ({ request, body, set }) => {
    const auth = await requireBlogAdminAuth(request);
    if (!auth.authorized) {
      set.status = auth.status;
      return auth.body;
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
        .select(TAG_COLS)
        .single();

      if (error || !data) {
        if (error?.code === '23505') {
          set.status = 409;
          return { error: 'Tag slug already exists' };
        }
        throw error;
      }

      set.status = 201;
      return mapBlogTag(data as BlogTagRow);
    } catch (_error) {
      set.status = 500;
      return { error: 'Failed to create tag' };
    }
  })

  /**
   * PUT /tags/:id - Update a tag (admin only)
   */
  .put('/tags/:id', async ({ request, body, params, set }) => {
    const auth = await requireBlogAdminAuth(request);
    if (!auth.authorized) {
      set.status = auth.status;
      return auth.body;
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
        .select(TAG_COLS)
        .single();

      if (error || !data) {
        if (slugNotFoundError(error)) {
          set.status = 404;
          return { error: 'Tag not found' };
        }
        if (error?.code === '23505') {
          set.status = 409;
          return { error: 'Tag slug already exists' };
        }
        throw error;
      }

      return mapBlogTag(data as BlogTagRow);
    } catch (_error) {
      set.status = 500;
      return { error: 'Failed to update tag' };
    }
  })

  /**
   * DELETE /tags/:id - Delete a tag (admin only)
   */
  .delete('/tags/:id', async ({ request, params, set }) => {
    const auth = await requireBlogAdminAuth(request);
    if (!auth.authorized) {
      set.status = auth.status;
      return auth.body;
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
    } catch (_error) {
      set.status = 500;
      return { error: 'Failed to delete tag' };
    }
  });
