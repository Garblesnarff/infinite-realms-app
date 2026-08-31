/**
 * Blog Admin Middleware for Elysia
 *
 * Requires blog admin role for protected endpoints.
 * Ported from /server/src/middleware/blog-admin.ts
 */

import { Elysia } from 'elysia';

import { getBlogRole, type BlogRole } from './blog-author.js';

import type { AuthTokenPayload } from './auth.js';

/**
 * Require blog admin role
 * Returns 403 if user is not an admin
 */
export const requireBlogAdmin = new Elysia({ name: 'require-blog-admin' })
  .derive({ as: 'scoped' }, async (context) => {
    // `user` is added by requireAuth in the consuming route, not by this
    // standalone authorization plugin.
    const { set } = context;
    const user = (context as typeof context & { user?: AuthTokenPayload | null }).user;
    if (!user?.userId) {
      set.status = 401;
      return {
        blogRole: null as BlogRole | null,
        blogAdminError: { error: 'Unauthorized' },
      };
    }

    // Development/testing override: allow bypassing Supabase role check
    const devOverrideEnabled =
      (process.env.BLOG_ADMIN_DEV_OVERRIDE === 'true' ||
        process.env.BLOG_ADMIN_DEV_OVERRIDE === '1') &&
      process.env.NODE_ENV !== 'production';

    if (devOverrideEnabled) {
      return { blogRole: 'admin' as BlogRole, blogAdminError: null };
    }

    try {
      const role = await getBlogRole(user.userId);
      if (role !== 'admin') {
        set.status = 403;
        return {
          blogRole: null as BlogRole | null,
          blogAdminError: { error: 'Blog admin access required' },
        };
      }

      return { blogRole: role, blogAdminError: null };
    } catch (_err) {
      set.status = 500;
      return {
        blogRole: null as BlogRole | null,
        blogAdminError: { error: 'Failed to verify blog admin access' },
      };
    }
  })
  .onBeforeHandle({ as: 'scoped' }, ({ blogAdminError, set: _set }) => {
    if (blogAdminError) {
      return blogAdminError;
    }
  });
