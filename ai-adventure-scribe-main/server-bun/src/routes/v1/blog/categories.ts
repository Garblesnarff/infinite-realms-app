/**
 * Blog Category Routes
 *
 * Category CRUD operations:
 * - GET /categories - List all categories (public)
 * - POST /categories - Create a category (admin only)
 * - PUT /categories/:id - Update a category (admin only)
 * - DELETE /categories/:id - Delete a category (admin only)
 */

import { Elysia } from 'elysia';

import { handleValidationError, slugNotFoundError, requireBlogAdminAuth } from './helpers.js';
import { mapBlogCategory } from './mappers.js';
import { blogCategorySchema, blogCategoryUpdateSchema } from './schemas.js';
import { supabaseService } from '../../../lib/supabase.js';

import type { BlogCategoryRow, BlogCategory } from './types.js';

export const blogCategoryRoutes = new Elysia()

  /**
   * GET /categories - List all categories
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
    } catch (_error) {
      set.status = 500;
      return { error: 'Failed to fetch categories' };
    }
  })

  /**
   * POST /categories - Create a category (admin only)
   */
  .post('/categories', async ({ request, body, set }) => {
    const auth = await requireBlogAdminAuth(request);
    if (!auth.authorized) {
      set.status = auth.status;
      return auth.body;
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
        if (error?.code === '23505') {
          set.status = 409;
          return { error: 'Category slug already exists' };
        }
        throw error;
      }

      set.status = 201;
      return mapBlogCategory(data as BlogCategoryRow);
    } catch (_error) {
      set.status = 500;
      return { error: 'Failed to create category' };
    }
  })

  /**
   * PUT /categories/:id - Update a category (admin only)
   */
  .put('/categories/:id', async ({ request, body, params, set }) => {
    const auth = await requireBlogAdminAuth(request);
    if (!auth.authorized) {
      set.status = auth.status;
      return auth.body;
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
        if (error?.code === '23505') {
          set.status = 409;
          return { error: 'Category slug already exists' };
        }
        throw error;
      }

      return mapBlogCategory(data as BlogCategoryRow);
    } catch (_error) {
      set.status = 500;
      return { error: 'Failed to update category' };
    }
  })

  /**
   * DELETE /categories/:id - Delete a category (admin only)
   */
  .delete('/categories/:id', async ({ request, params, set }) => {
    const auth = await requireBlogAdminAuth(request);
    if (!auth.authorized) {
      set.status = auth.status;
      return auth.body;
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
    } catch (_error) {
      set.status = 500;
      return { error: 'Failed to delete category' };
    }
  });
