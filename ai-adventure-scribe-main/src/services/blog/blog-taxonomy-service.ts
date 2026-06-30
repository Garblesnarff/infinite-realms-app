import type { BlogCategory, BlogTag } from '@/types/blog';
import type { SupabaseClient } from '@supabase/supabase-js';

import { supabase } from '@/integrations/supabase/client';

const supabaseClient = supabase as SupabaseClient<any, any, any>;

export const mapCategory = (row: any): BlogCategory => ({
  id: String(row.id),
  title: row.name ?? row.title ?? '',
  slug: row.slug ?? '',
  description: row.description ?? null,
  createdAt: row.created_at ?? row.createdAt ?? new Date().toISOString(),
  updatedAt: row.updated_at ?? row.updatedAt ?? null,
  createdBy: row.created_by ?? row.createdBy ?? null,
});

export const mapTag = (row: any): BlogTag => ({
  id: String(row.id),
  name: row.name ?? '',
  slug: row.slug ?? '',
  description: row.description ?? null,
  createdAt: row.created_at ?? row.createdAt ?? new Date().toISOString(),
  updatedAt: row.updated_at ?? row.updatedAt ?? null,
  createdBy: row.created_by ?? row.createdBy ?? null,
});

export const listBlogCategories = async (): Promise<BlogCategory[]> => {
  // ⚡ Bolt: Optimized to use explicit columns instead of select('*') to reduce over-fetching.
  const { data, error } = await supabaseClient
    .from('blog_categories')
    .select('id, name, slug, description, created_at, updated_at')
    .order('name', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map(mapCategory);
};

export const createBlogCategory = async (input: {
  title: string;
  slug: string;
  description?: string | null;
}): Promise<BlogCategory> => {
  const { data, error } = await supabaseClient
    .from('blog_categories')
    .insert({
      name: input.title,
      slug: input.slug,
      description: input.description ?? null,
    })
    // ⚡ Bolt: Optimized to use explicit columns instead of select('*') to reduce over-fetching.
    .select('id, name, slug, description, created_at, updated_at')
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return mapCategory(data);
};

export const updateBlogCategory = async (
  id: string,
  input: { title?: string; slug?: string; description?: string | null },
): Promise<BlogCategory> => {
  const { data, error } = await supabaseClient
    .from('blog_categories')
    .update({
      ...(input.title !== undefined ? { name: input.title } : {}),
      ...(input.slug !== undefined ? { slug: input.slug } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    })
    .eq('id', id)
    // ⚡ Bolt: Optimized to use explicit columns instead of select('*') to reduce over-fetching.
    .select('id, name, slug, description, created_at, updated_at')
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return mapCategory(data);
};

export const deleteBlogCategory = async (id: string): Promise<void> => {
  const { error } = await supabaseClient.from('blog_categories').delete().eq('id', id);

  if (error) {
    throw new Error(error.message);
  }
};

export const listBlogTags = async (): Promise<BlogTag[]> => {
  // ⚡ Bolt: Optimized to use explicit columns instead of select('*') to reduce over-fetching.
  const { data, error } = await supabaseClient
    .from('blog_tags')
    .select('id, name, slug, description, created_at, updated_at')
    .order('name', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map(mapTag);
};

export const createBlogTag = async (input: {
  name: string;
  slug: string;
  description?: string | null;
}): Promise<BlogTag> => {
  const { data, error } = await supabaseClient
    .from('blog_tags')
    .insert({
      name: input.name,
      slug: input.slug,
      description: input.description ?? null,
    })
    // ⚡ Bolt: Optimized to use explicit columns instead of select('*') to reduce over-fetching.
    .select('id, name, slug, description, created_at, updated_at')
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return mapTag(data);
};

export const updateBlogTag = async (
  id: string,
  input: { name?: string; slug?: string; description?: string | null },
): Promise<BlogTag> => {
  const { data, error } = await supabaseClient
    .from('blog_tags')
    .update({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.slug !== undefined ? { slug: input.slug } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    })
    .eq('id', id)
    // ⚡ Bolt: Optimized to use explicit columns instead of select('*') to reduce over-fetching.
    .select('id, name, slug, description, created_at, updated_at')
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return mapTag(data);
};

export const deleteBlogTag = async (id: string): Promise<void> => {
  const { error } = await supabaseClient.from('blog_tags').delete().eq('id', id);

  if (error) {
    throw new Error(error.message);
  }
};
