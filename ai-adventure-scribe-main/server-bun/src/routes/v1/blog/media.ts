/**
 * Blog Media Routes
 *
 * Image upload and media management:
 * - POST /media/sign-upload - Get a signed upload URL (admin only)
 */

import { Elysia } from 'elysia';

import { handleValidationError, requireBlogAdminAuth } from './helpers.js';
import { blogMediaRequestSchema } from './schemas.js';
import { supabaseService } from '../../../lib/supabase.js';

export const blogMediaRoutes = new Elysia()

  /**
   * POST /media/sign-upload - Get a signed upload URL (admin only)
   */
  .post('/media/sign-upload', async ({ request, body, set }) => {
    const auth = await requireBlogAdminAuth(request);
    if (!auth.authorized) {
      set.status = auth.status;
      return auth.body;
    }

    const parsed = blogMediaRequestSchema.safeParse(body ?? {});
    if (!parsed.success) {
      set.status = 400;
      return handleValidationError(parsed.error);
    }

    const { path } = parsed.data;
    const bucket = process.env.BLOG_MEDIA_BUCKET;

    if (!bucket) {
      set.status = 500;
      return { error: 'Internal server error' };
    }

    try {
      const storageBucket = supabaseService.storage.from(bucket);
      const { data, error } = await storageBucket.createSignedUploadUrl(path);

      if (error || !data) {
        throw error;
      }

      return {
        signedUrl: data.signedUrl,
        path: data.path,
        token: data.token,
      };
    } catch (_error) {
      set.status = 500;
      return { error: 'Failed to generate upload URL' };
    }
  });
