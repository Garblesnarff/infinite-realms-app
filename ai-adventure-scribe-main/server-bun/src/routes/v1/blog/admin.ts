/**
 * Blog Admin Routes
 *
 * Admin dashboard endpoints:
 * - GET /admin/posts - List all posts for admin (author/admin)
 */

import { Elysia } from 'elysia';

import { handleValidationError, requireBlogAuth, BLOG_POST_SUMMARY_SELECT } from './helpers.js';
import { mapBlogPost } from './mappers.js';
import { blogListQuerySchema } from './schemas.js';
import { supabaseService } from '../../../lib/supabase.js';

import type { BlogPostRow } from './types.js';

export const blogAdminRoutes = new Elysia()

  /**
   * GET /admin/posts - List all posts for admin (author/admin)
   */
  .get('/admin/posts', async ({ request, query, set }) => {
    const auth = await requireBlogAuth(request);
    if (!auth.authorized) {
      set.status = auth.status;
      return auth.body;
    }
    const { user, blogRole } = auth;

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
        const sanitized = search.trim().toLowerCase();
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

      const mapped = (data ?? []).map((row) =>
        mapBlogPost(row as unknown as BlogPostRow, { includeContent: false }),
      );
      const filtered = mapped.filter((post) => {
        const categoryOk =
          !category || post.categories.some((c) => c.slug === category || c.id === category);
        const tagOk = !tag || post.tags.some((t) => t.slug === tag || t.id === tag);
        return categoryOk && tagOk;
      });

      return {
        data: filtered,
        meta: {
          page,
          pageSize,
          total: category || tag ? filtered.length : (count ?? filtered.length),
        },
      };
    } catch (_error) {
      set.status = 500;
      return { error: 'Failed to fetch blog posts' };
    }
  });
