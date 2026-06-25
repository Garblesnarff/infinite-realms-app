import { mapCategory, mapTag } from './blog-taxonomy-service';

import type {
  BlogPost,
  BlogPostListFilters,
  BlogPostStatus,
} from '@/types/blog';
import type { SupabaseClient } from '@supabase/supabase-js';

import { supabase } from '@/integrations/supabase/client';

const supabaseClient = supabase as SupabaseClient<any, any, any>;

export type BlogPostMutationInput = {
  title: string;
  slug: string;
  content: string;
  excerpt?: string | null;
  coverImageUrl?: string | null;
  status: BlogPostStatus;
  seoTitle?: string | null;
  seoDescription?: string | null;
  publishedAt?: string | null;
  scheduledFor?: string | null;
  categoryIds?: string[];
  tagIds?: string[];
  allowComments?: boolean;
};

type Maybe<T> = T | null | undefined;

const toStringArray = (value: Maybe<any>): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => (item == null ? null : String(item)))
      .filter((item): item is string => Boolean(item));
  }
  return [];
};

const coerceDate = (value: Maybe<string>): string | null => {
  if (!value) return null;
  try {
    const iso = new Date(value).toISOString();
    if (iso === 'Invalid Date') return null;
    return iso;
  } catch {
    return null;
  }
};

const mapBlogPost = (row: any): BlogPost => ({
  id: String(row.id),
  title: row.title ?? '',
  slug: row.slug ?? '',
  excerpt: row.excerpt ?? row.summary ?? null,
  content: row.content ?? '',
  coverImageUrl: row.cover_image_url ?? row.featured_image_url ?? row.coverImageUrl ?? null,
  status: (row.status ?? 'draft') as BlogPostStatus,
  seoTitle: row.seo_title ?? row.seoTitle ?? null,
  seoDescription: row.seo_description ?? row.seoDescription ?? null,
  publishedAt: coerceDate(row.published_at ?? row.publishedAt),
  scheduledFor: coerceDate(row.scheduled_for ?? row.scheduledFor),
  createdAt: row.created_at ?? row.createdAt ?? new Date().toISOString(),
  updatedAt: row.updated_at ?? row.updatedAt ?? row.created_at ?? new Date().toISOString(),
  authorId: row.author_id ?? row.authorId ?? '',
  authorRole: row.authorRole ?? null,
  categoryIds: toStringArray(row.category_ids ?? row.categoryIds),
  tagIds: toStringArray(row.tag_ids ?? row.tagIds),
  categories: Array.isArray(row.categories) ? row.categories.map(mapCategory) : undefined,
  tags: Array.isArray(row.tags) ? row.tags.map(mapTag) : undefined,
});

const buildInsertPayload = (input: BlogPostMutationInput) => ({
  title: input.title,
  slug: input.slug,
  content: input.content,
  summary: input.excerpt ?? null,
  featured_image_url: input.coverImageUrl ?? null,
  status: input.status,
  seo_title: input.seoTitle ?? null,
  seo_description: input.seoDescription ?? null,
  published_at: input.publishedAt ?? null,
  scheduled_for: input.scheduledFor ?? null,
  /* columns for category/tag links moved to join tables; kept here for compatibility no-ops */
  allow_comments: input.allowComments ?? true,
});

const buildUpdatePayload = (input: Partial<BlogPostMutationInput>) => {
  const payload: Record<string, any> = {};
  if (input.title !== undefined) payload.title = input.title;
  if (input.slug !== undefined) payload.slug = input.slug;
  if (input.content !== undefined) payload.content = input.content;
  if (input.excerpt !== undefined) payload.summary = input.excerpt ?? null;
  if (input.coverImageUrl !== undefined) payload.featured_image_url = input.coverImageUrl ?? null;
  if (input.status !== undefined) payload.status = input.status;
  if (input.seoTitle !== undefined) payload.seo_title = input.seoTitle ?? null;
  if (input.seoDescription !== undefined) payload.seo_description = input.seoDescription ?? null;
  if (input.publishedAt !== undefined) payload.published_at = input.publishedAt ?? null;
  if (input.scheduledFor !== undefined) payload.scheduled_for = input.scheduledFor ?? null;
  // category_ids and tag_ids are maintained via join tables in this schema
  if (input.allowComments !== undefined) payload.allow_comments = input.allowComments;
  return payload;
};

export const listBlogPosts = async (filters?: BlogPostListFilters): Promise<BlogPost[]> => {
  /**
   * ⚡ Bolt: Optimized to exclude the large 'content' field in list view
   * to reduce over-fetching and minimize payload size.
   */
  let query = supabaseClient.from('blog_posts').select(`
      id,
      title,
      slug,
      summary,
      featured_image_url,
      status,
      seo_title,
      seo_description,
      published_at,
      scheduled_for,
      created_at,
      updated_at,
      author_id
    `);

  if (filters?.status && filters.status !== 'all') {
    query = query.eq('status', filters.status);
  }
  if (filters?.scheduledOnly) {
    query = query.not('scheduled_for', 'is', null);
  }
  if (filters?.search) {
    query = query.ilike('title', `%${filters.search}%`);
  }
  // category/tag filters require joins; omitted in this minimal client query

  const sortBy = filters?.sortBy || 'updatedAt';
  const ascending = filters?.sortDirection === 'asc';
  const columnMap: Record<string, string> = {
    updatedAt: 'updated_at',
    createdAt: 'created_at',
    title: 'title',
    status: 'status',
    publishedAt: 'published_at',
  };
  query = query.order(columnMap[sortBy] || 'updated_at', {
    ascending,
    nullsFirst: ascending,
  });

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []).map((row: any) => ({
    ...row,
    excerpt: row.summary,
    cover_image_url: row.featured_image_url,
  }));
  return rows.map(mapBlogPost);
};

export const getBlogPostById = async (id: string): Promise<BlogPost | null> => {
  const { data, error } = await supabaseClient
    .from('blog_posts')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data ? mapBlogPost(data) : null;
};

export const getBlogPostBySlug = async (slug: string): Promise<BlogPost | null> => {
  const { data, error } = await supabaseClient
    .from('blog_posts')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data ? mapBlogPost(data) : null;
};

export const createBlogPost = async (input: BlogPostMutationInput): Promise<BlogPost> => {
  const payload = buildInsertPayload(input);
  const { data, error } = await supabaseClient
    .from('blog_posts')
    .insert(payload)
    .select('*')
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return mapBlogPost(data);
};

export const updateBlogPost = async (
  id: string,
  input: Partial<BlogPostMutationInput>,
): Promise<BlogPost> => {
  if (!id) throw new Error('Missing blog post id');
  const payload = buildUpdatePayload(input);

  if (Object.keys(payload).length === 0) {
    const existing = await getBlogPostById(id);
    if (!existing) {
      throw new Error('Unable to load blog post for update');
    }
    return existing;
  }

  const { data, error } = await supabaseClient
    .from('blog_posts')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return mapBlogPost(data);
};

export const deleteBlogPost = async (id: string): Promise<void> => {
  const { error } = await supabaseClient.from('blog_posts').delete().eq('id', id);

  if (error) {
    throw new Error(error.message);
  }
};

export {
  listBlogCategories,
  createBlogCategory,
  updateBlogCategory,
  deleteBlogCategory,
  listBlogTags,
  createBlogTag,
  updateBlogTag,
  deleteBlogTag,
} from './blog-taxonomy-service';

export {
  BLOG_MEDIA_BUCKET,
  BLOG_MEDIA_PREFIX,
  listBlogMedia,
  requestSignedUpload,
  uploadWithSignedUrl,
  deleteBlogMedia,
  buildMediaPublicUrl,
} from './blog-media-service';
