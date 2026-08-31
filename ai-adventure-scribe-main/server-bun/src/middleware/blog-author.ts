/**
 * Blog Author Middleware for Elysia
 *
 * Provides blog role checking and author verification.
 * Ported from /server/src/middleware/blog-author.ts
 */

import { Elysia } from 'elysia';

import { supabaseService } from '../lib/supabase.js';

import type { AuthTokenPayload } from './auth.js';

export type BlogRole = 'viewer' | 'author' | 'admin';

function normalizeRole(role: unknown): BlogRole | null {
  if (typeof role !== 'string') return null;
  const normalized = role.toLowerCase();
  if (normalized === 'admin' || normalized === 'author' || normalized === 'viewer') {
    return normalized;
  }
  return null;
}

export async function getBlogRole(userId: string): Promise<BlogRole> {
  try {
    const { data: profileData } = await supabaseService
      .from('user_profiles')
      .select('blog_role')
      .eq('user_id', userId)
      .maybeSingle();

    const profileRole = normalizeRole(profileData?.blog_role);
    if (profileRole) {
      return profileRole;
    }

    const { data: authorData } = await supabaseService
      .from('blog_authors')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();

    if (authorData) {
      return 'author';
    }

    return 'viewer';
  } catch {
    return 'viewer';
  }
}

export async function canManagePost(postId: string, userId: string): Promise<boolean> {
  try {
    const { data: result, error } = await supabaseService.rpc('can_manage_blog_post', {
      p_post_id: postId,
      p_user_id: userId,
    });
    if (error) {
      throw error;
    }
    return result === true;
  } catch {
    return false;
  }
}

/**
 * Require blog author or admin role
 * Returns 403 if user is a viewer
 */
export const requireBlogAuthor = new Elysia({ name: 'require-blog-author' })
  .derive({ as: 'scoped' }, async (context) => {
    // `user` is added by requireAuth in the consuming route, not by this
    // standalone authorization plugin.
    const { set } = context;
    const user = (context as typeof context & { user?: AuthTokenPayload | null }).user;
    if (!user?.userId) {
      set.status = 401;
      return {
        blogRole: null as BlogRole | null,
        blogError: { error: 'Unauthorized' },
      };
    }

    try {
      const role = await getBlogRole(user.userId);
      if (role === 'viewer') {
        set.status = 403;
        return {
          blogRole: null as BlogRole | null,
          blogError: { error: 'Blog author or admin access required' },
        };
      }

      return { blogRole: role, blogError: null };
    } catch (_err) {
      set.status = 500;
      return {
        blogRole: null as BlogRole | null,
        blogError: { error: 'Failed to verify blog author access' },
      };
    }
  })
  .onBeforeHandle({ as: 'scoped' }, ({ blogError, set: _set }) => {
    if (blogError) {
      return blogError;
    }
  });
