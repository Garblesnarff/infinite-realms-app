import type {
  BlogMediaAsset,
  SignedUploadRequest,
  SignedUploadResponse,
} from '@/types/blog';
import type { SupabaseClient } from '@supabase/supabase-js';

import { supabase } from '@/integrations/supabase/client';
import { getAuthHeaders } from '@/services/auth/TokenService';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8888';
const BLOG_MEDIA_BUCKET = 'blog-media';
const BLOG_MEDIA_PREFIX = 'uploads';

const supabaseClient = supabase as SupabaseClient<any, any, any>;

const fetchWithAuth = async (path: string, options: RequestInit = {}): Promise<Response> => {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
      ...getAuthHeaders(),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || res.statusText);
  }

  return res;
};

export const listBlogMedia = async (
  prefix: string = BLOG_MEDIA_PREFIX,
  bucket: string = BLOG_MEDIA_BUCKET,
): Promise<BlogMediaAsset[]> => {
  const { data, error } = await supabaseClient.storage
    .from(bucket)
    .list(prefix, { limit: 500, offset: 0 });

  if (error) {
    throw new Error(error.message);
  }

  if (!Array.isArray(data)) {
    return [];
  }

  const assets: BlogMediaAsset[] = data
    .filter((item: any) => item && typeof item.name === 'string' && !item.name.endsWith('/'))
    .map((item: any) => {
      const path = `${prefix}/${item.name}`;
      const { data: urlData } = supabaseClient.storage.from(bucket).getPublicUrl(path);
      return {
        id: path,
        path,
        bucket,
        publicUrl: urlData.publicUrl,
        name: item.name,
        mimeType: item.metadata?.mimetype ?? item.content_type ?? null,
        size: item.size ?? item.metadata?.size ?? null,
        createdAt: item.created_at ?? item.updated_at ?? null,
      } as BlogMediaAsset;
    });

  assets.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return assets;
};

export const requestSignedUpload = async (
  params: SignedUploadRequest,
): Promise<SignedUploadResponse> => {
  const res = await fetchWithAuth('/v1/blog/media/sign-upload', {
    method: 'POST',
    body: JSON.stringify({
      filename: params.filename,
      contentType: params.contentType,
      bucket: params.bucket || BLOG_MEDIA_BUCKET,
    }),
  });
  const data = (await res.json()) as SignedUploadResponse;
  return data;
};

export const uploadWithSignedUrl = async (
  signedUrl: string,
  file: Blob,
  contentType: string,
): Promise<void> => {
  const res = await fetch(signedUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
    },
    body: file,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || res.statusText);
  }
};

export const deleteBlogMedia = async (
  path: string,
  bucket: string = BLOG_MEDIA_BUCKET,
): Promise<void> => {
  const { error } = await supabaseClient.storage.from(bucket).remove([path]);
  if (error) {
    throw new Error(error.message);
  }
};

export const buildMediaPublicUrl = (path: string, bucket: string = BLOG_MEDIA_BUCKET): string => {
  const { data } = supabaseClient.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
};

export { BLOG_MEDIA_BUCKET, BLOG_MEDIA_PREFIX };
