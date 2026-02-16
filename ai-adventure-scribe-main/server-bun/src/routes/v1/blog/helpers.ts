/* eslint-disable max-lines */
/**
 * Blog Route Helpers
 * Shared utilities for blog route handlers
 * Extracted from blog.ts for modularity
 */

import { authenticateRequest, type AuthUser } from '../../../lib/auth.js';
import { sql } from '../../../lib/db.js';
import { supabaseService } from '../../../lib/supabase.js';
import { getBlogRole } from '../../../middleware/blog-author.js';

import type { ZodError } from 'zod';

export type BlogRole = 'viewer' | 'author' | 'admin';

// ===== Auth Guard Helpers =====
// These replace the repeated 6-line auth+role pattern in route handlers.
// We use imperative helpers (not Elysia derive/guard) because this codebase
// avoids Elysia's plugin context propagation for REST routes (see lib/auth.ts).

interface BlogAuthSuccess {
  authorized: true;
  user: AuthUser;
  blogRole: BlogRole;
}

interface BlogAuthFailure {
  authorized: false;
  status: number;
  body: { error: string };
}

export type BlogAuthResult = BlogAuthSuccess | BlogAuthFailure;

/**
 * Authenticate request and require blog author or admin role.
 *
 * Replaces the repeated pattern:
 * ```
 * const { user, error: authError } = await authenticateRequest(request);
 * if (authError || !user) { set.status = 401; return { error: ... }; }
 * const blogRole = await getBlogRole(user.userId);
 * if (blogRole === 'viewer') { set.status = 403; return { error: ... }; }
 * ```
 */
export async function requireBlogAuth(request: Request): Promise<BlogAuthResult> {
  const { user, error: authError } = await authenticateRequest(request);
  if (authError || !user) {
    return { authorized: false, status: 401, body: { error: authError || 'Unauthorized' } };
  }

  const blogRole = await getBlogRole(user.userId);
  if (blogRole === 'viewer') {
    return {
      authorized: false,
      status: 403,
      body: { error: 'Blog author or admin access required' },
    };
  }

  return { authorized: true, user, blogRole };
}

/**
 * Authenticate request and require blog admin role.
 *
 * Replaces the repeated pattern:
 * ```
 * const { user, error: authError } = await authenticateRequest(request);
 * if (authError || !user) { set.status = 401; return { error: ... }; }
 * const blogRole = await getBlogRole(user.userId);
 * if (blogRole !== 'admin') { set.status = 403; return { error: ... }; }
 * ```
 */
export async function requireBlogAdminAuth(request: Request): Promise<BlogAuthResult> {
  const { user, error: authError } = await authenticateRequest(request);
  if (authError || !user) {
    return { authorized: false, status: 401, body: { error: authError || 'Unauthorized' } };
  }

  const blogRole = await getBlogRole(user.userId);
  if (blogRole !== 'admin') {
    return { authorized: false, status: 403, body: { error: 'Blog admin access required' } };
  }

  return { authorized: true, user, blogRole };
}

/**
 * Handle Zod validation errors
 */
export function handleValidationError(error: ZodError) {
  return {
    error: 'Invalid request payload',
    details: error.flatten(),
  };
}

/**
 * Sync post-category and post-tag relations
 */
export async function syncPostRelations(
  postId: string,
  categoryIds?: string[],
  tagIds?: string[],
  authorScopeId?: string | null,
) {
  if (authorScopeId) {
    const { data: scopedPost, error: scopedError } = await supabaseService
      .from('blog_posts')
      .select('id')
      .eq('id', postId)
      .eq('author_id', authorScopeId)
      .maybeSingle();

    if (scopedError) throw scopedError;
    if (!scopedPost) throw new Error('BLOG_POST_NOT_FOUND');
  }

  if (categoryIds !== undefined) {
    if (authorScopeId) {
      await sql`
        DELETE FROM blog_post_categories bpc
        WHERE bpc.post_id = ${postId}
          AND EXISTS (
            SELECT 1
            FROM blog_posts bp
            WHERE bp.id = bpc.post_id
              AND bp.author_id = ${authorScopeId}
          )
      `;

      for (const categoryId of categoryIds) {
        await sql`
          INSERT INTO blog_post_categories (post_id, category_id)
          SELECT ${postId}, ${categoryId}
          WHERE EXISTS (
            SELECT 1
            FROM blog_posts bp
            WHERE bp.id = ${postId}
              AND bp.author_id = ${authorScopeId}
          )
          ON CONFLICT DO NOTHING
        `;
      }
    } else {
      const { error: deleteError } = await supabaseService
        .from('blog_post_categories')
        .delete()
        .eq('post_id', postId);
      if (deleteError) throw deleteError;

      if (categoryIds.length > 0) {
        const insertPayload = categoryIds.map((categoryId) => ({
          post_id: postId,
          category_id: categoryId,
        }));
        const { error: insertError } = await supabaseService
          .from('blog_post_categories')
          .insert(insertPayload);
        if (insertError) throw insertError;
      }
    }
  }

  if (tagIds !== undefined) {
    if (authorScopeId) {
      await sql`
        DELETE FROM blog_post_tags bpt
        WHERE bpt.post_id = ${postId}
          AND EXISTS (
            SELECT 1
            FROM blog_posts bp
            WHERE bp.id = bpt.post_id
              AND bp.author_id = ${authorScopeId}
          )
      `;

      for (const tagId of tagIds) {
        await sql`
          INSERT INTO blog_post_tags (post_id, tag_id)
          SELECT ${postId}, ${tagId}
          WHERE EXISTS (
            SELECT 1
            FROM blog_posts bp
            WHERE bp.id = ${postId}
              AND bp.author_id = ${authorScopeId}
          )
          ON CONFLICT DO NOTHING
        `;
      }
    } else {
      const { error: deleteError } = await supabaseService
        .from('blog_post_tags')
        .delete()
        .eq('post_id', postId);
      if (deleteError) throw deleteError;

      if (tagIds.length > 0) {
        const insertPayload = tagIds.map((tagId) => ({
          post_id: postId,
          tag_id: tagId,
        }));
        const { error: insertError } = await supabaseService
          .from('blog_post_tags')
          .insert(insertPayload);
        if (insertError) throw insertError;
      }
    }
  }
}

/**
 * Delete all category/tag relations for a post, optionally scoped to an author.
 */
export async function deletePostRelations(postId: string, authorScopeId?: string | null) {
  if (authorScopeId) {
    const { data: scopedPost, error: scopedError } = await supabaseService
      .from('blog_posts')
      .select('id')
      .eq('id', postId)
      .eq('author_id', authorScopeId)
      .maybeSingle();

    if (scopedError) throw scopedError;
    if (!scopedPost) throw new Error('BLOG_POST_NOT_FOUND');

    await sql`
      DELETE FROM blog_post_categories bpc
      WHERE bpc.post_id = ${postId}
        AND EXISTS (
          SELECT 1
          FROM blog_posts bp
          WHERE bp.id = bpc.post_id
            AND bp.author_id = ${authorScopeId}
        )
    `;

    await sql`
      DELETE FROM blog_post_tags bpt
      WHERE bpt.post_id = ${postId}
        AND EXISTS (
          SELECT 1
          FROM blog_posts bp
          WHERE bp.id = bpt.post_id
            AND bp.author_id = ${authorScopeId}
        )
    `;

    return;
  }

  const { error: categoryDeleteError } = await supabaseService
    .from('blog_post_categories')
    .delete()
    .eq('post_id', postId);
  if (categoryDeleteError) throw categoryDeleteError;

  const { error: tagDeleteError } = await supabaseService
    .from('blog_post_tags')
    .delete()
    .eq('post_id', postId);
  if (tagDeleteError) throw tagDeleteError;
}

/**
 * Check if error is a "not found" PGRST116 error
 */
export const slugNotFoundError = (error: { code?: string } | null | undefined) =>
  error != null && error.code === 'PGRST116';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Check if a string is a valid UUID
 */
export function isUuid(value: string | null | undefined): value is string {
  if (!value) return false;
  return UUID_REGEX.test(value);
}

/**
 * Fetch author ID for a user
 */
export async function fetchAuthorIdForUser(userId: string): Promise<string | null> {
  const { data, error } = await supabaseService
    .from('blog_authors')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data?.id ?? null;
}

/**
 * Ensure an author exists by ID
 */
export async function ensureAuthorExists(authorId: string): Promise<boolean> {
  if (!isUuid(authorId)) return false;
  const { data, error } = await supabaseService
    .from('blog_authors')
    .select('id')
    .eq('id', authorId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return Boolean(data?.id);
}

/**
 * Resolve author ID for a request, handling admin override
 */
export async function resolveAuthorIdForRequest(
  userId: string,
  blogRole: BlogRole,
  explicitAuthorId?: string | null,
): Promise<string> {
  if (blogRole === 'admin' && explicitAuthorId) {
    const exists = await ensureAuthorExists(explicitAuthorId);
    if (!exists) {
      throw new Error('BLOG_AUTHOR_NOT_FOUND');
    }
    return explicitAuthorId;
  }

  const authorId = await fetchAuthorIdForUser(userId);
  if (!authorId) {
    throw new Error('BLOG_AUTHOR_PROFILE_REQUIRED');
  }
  return authorId;
}

/**
 * Normalize SEO keywords array
 */
export function normalizeSeoKeywords(keywords?: string[] | null): string[] {
  if (!keywords || keywords.length === 0) return [];
  const normalized = keywords.map((value) => value.trim()).filter(Boolean);
  return normalized;
}

/**
 * Normalize metadata object
 */
export function normalizeMetadata(
  metadata?: Record<string, unknown> | null,
): Record<string, unknown> {
  if (metadata && typeof metadata === 'object') {
    return metadata;
  }
  return {};
}

/**
 * Normalize status payload with proper date handling
 */
export function normalizeStatusPayload(
  status: string,
  scheduledFor?: string | null,
  publishedAt?: string | null,
) {
  const payload: Record<string, unknown> = { status };

  switch (status) {
    case 'published': {
      payload.published_at = publishedAt ?? new Date().toISOString();
      payload.scheduled_for = null;
      break;
    }
    case 'scheduled': {
      payload.scheduled_for = scheduledFor ?? null;
      payload.published_at = null;
      break;
    }
    case 'draft':
    case 'review':
    case 'archived':
    default: {
      payload.scheduled_for = null;
      payload.published_at = null;
      break;
    }
  }

  return payload;
}

/**
 * Get author scope ID for mutation operations.
 * Admins get null (no scope restriction), authors get their own author ID.
 */
export async function getAuthorScopeIdForMutation(
  blogRole: BlogRole,
  userId: string,
): Promise<string | null> {
  if (blogRole === 'admin') {
    return null;
  }

  return await fetchAuthorIdForUser(userId);
}

/**
 * SQL select clauses for blog posts
 */
export const BLOG_POST_SELECT = `
  id,
  slug,
  title,
  summary,
  content,
  featured_image_url,
  hero_image_alt,
  seo_title,
  seo_description,
  seo_keywords,
  canonical_url,
  status,
  scheduled_for,
  published_at,
  metadata,
  created_at,
  updated_at,
  author_id,
  categories:blog_post_categories (
    category:blog_categories (
      id,
      slug,
      name,
      description,
      created_at,
      updated_at
    )
  ),
  tags:blog_post_tags (
    tag:blog_tags (
      id,
      slug,
      name,
      description,
      created_at,
      updated_at
    )
  )
`;

export const BLOG_POST_SUMMARY_SELECT = `
  id,
  slug,
  title,
  summary,
  featured_image_url,
  hero_image_alt,
  status,
  scheduled_for,
  published_at,
  created_at,
  updated_at,
  author_id,
  categories:blog_post_categories (
    category:blog_categories (
      id,
      slug,
      name,
      description
    )
  ),
  tags:blog_post_tags (
    tag:blog_tags (
      id,
      slug,
      name
    )
  )
`;
