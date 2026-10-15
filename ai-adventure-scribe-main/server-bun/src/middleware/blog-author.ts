/**
 * Blog Author Middleware for Elysia
 *
 * Provides blog role checking and author verification.
 * Ported from /server/src/middleware/blog-author.ts
 */

import { supabaseService } from '../lib/supabase.js';

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

