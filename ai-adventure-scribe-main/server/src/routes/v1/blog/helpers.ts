/**
 * Blog Route Helpers
 * Shared utilities for blog route handlers
 * Extracted from blog.ts for modularity
 */

import { Request, Response } from 'express';
import { supabaseService } from '../../../lib/supabase.js';

/**
 * Handle Zod validation errors
 */
export function handleValidationError(res: Response, error: any) {
  return res.status(400).json({
    error: 'Invalid request payload',
    details: error?.flatten?.() ?? error?.issues ?? error,
  });
}

/**
 * Sync post-category and post-tag relations
 */
export async function syncPostRelations(postId: string, categoryIds?: string[], tagIds?: string[]) {
  if (categoryIds !== undefined) {
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

  if (tagIds !== undefined) {
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

/**
 * Check if error is a "not found" PGRST116 error
 */
export const slugNotFoundError = (error: any) =>
  error && typeof error === 'object' && 'code' in error && (error as any).code === 'PGRST116';

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
  req: Request,
  explicitAuthorId?: string | null
): Promise<string> {
  const userId = req.user!.userId;
  const role = req.blogRole ?? 'viewer';

  if (role === 'admin' && explicitAuthorId) {
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
export function normalizeMetadata(metadata?: Record<string, unknown> | null): Record<string, unknown> {
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
  publishedAt?: string | null
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
