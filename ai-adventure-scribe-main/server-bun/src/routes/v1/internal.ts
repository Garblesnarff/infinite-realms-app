/**
 * Internal Routes for Elysia
 *
 * Provides internal/automation endpoints:
 * - POST /v1/internal/release-post - Create release blog post (GitHub Actions)
 * - POST /v1/internal/generate-api-key - Generate new API key (admin setup)
 *
 * Ported from /server/src/routes/v1/internal.ts
 *
 * @deprecated /v1/internal/generate-api-key has no frontend callers as of 2026-07-08.
 */

import { Elysia, t } from 'elysia';

import { logger } from '../../lib/logger.js';
import { supabaseService } from '../../lib/supabase.js';
import { requireApiKey, hasPermission, generateApiKey } from '../../middleware/api-key.js';

const RELEASE_NOTES_CATEGORY_SLUG = 'release-notes';
const SYSTEM_AUTHOR_ID = process.env.BLOG_SYSTEM_AUTHOR_ID || null;

/**
 * Get or create the release notes category
 */
async function getOrCreateCategory(): Promise<string | null> {
  // Try to get existing category
  const { data: existing } = await supabaseService
    .from('blog_categories')
    .select('id')
    .eq('slug', RELEASE_NOTES_CATEGORY_SLUG)
    .maybeSingle();

  if (existing) {
    return existing.id;
  }

  // Create the category
  const { data: created, error } = await supabaseService
    .from('blog_categories')
    .insert({
      slug: RELEASE_NOTES_CATEGORY_SLUG,
      name: 'Release Notes',
      description: 'Version releases and changelog updates for Infinite Realms',
    })
    .select('id')
    .single();

  if (error) {
    logger.error({ msg: 'Failed to create release-notes category', error });
    return null;
  }

  return created.id;
}

/**
 * Build release post content
 */
function buildReleasePostContent(version: string, changelog: string, commitHash?: string): string {
  let content = `# Infinite Realms v${version}\n\n`;
  content += `*Released on ${new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })}*\n\n`;

  content += `---\n\n`;
  content += changelog;

  if (commitHash) {
    content += `\n\n---\n\n`;
    content += `**Commit:** [\`${commitHash.slice(0, 7)}\`](https://github.com/Garblesnarff/infinite-realms-production/commit/${commitHash})`;
  }

  return content;
}

/**
 * Build release summary
 */
function buildReleaseSummary(version: string, changelog: string): string {
  // Extract first paragraph or first 200 chars
  const lines = changelog.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  const firstParagraph = lines[0] || '';

  if (firstParagraph.length > 200) {
    return firstParagraph.slice(0, 197) + '...';
  }

  return firstParagraph || `Release notes for version ${version}`;
}

export const internalRoutes = new Elysia({ prefix: '/v1/internal' })

  /**
   * POST /v1/internal/release-post
   * Create and publish a blog post for a release.
   * Used by GitHub Actions workflow for automated changelog posts.
   */
  .use(requireApiKey)
  .use(hasPermission('create_release_post'))
  .post('/release-post', async ({ body, apiKey: _apiKey, set }) => {
    try {
      const { version, changelog, commitHash } = body as {
        version?: string;
        changelog?: string;
        commitHash?: string;
      };

      if (!version || typeof version !== 'string') {
        set.status = 400;
        return { error: 'version is required' };
      }

      if (!changelog || typeof changelog !== 'string') {
        set.status = 400;
        return { error: 'changelog is required' };
      }

      const slug = `release-v${version.replace(/\./g, '-')}`;
      const title = `v${version} Release Notes`;
      const publishedAt = new Date().toISOString();

      // Build the blog post content
      const content = buildReleasePostContent(version, changelog, commitHash);
      const summary = buildReleaseSummary(version, changelog);

      // Check if release notes category exists, create if not
      const categoryId = await getOrCreateCategory();

      // Check if a post with this slug already exists
      const { data: existingPost } = await supabaseService
        .from('blog_posts')
        .select('id')
        .eq('slug', slug)
        .maybeSingle();

      let postId: string;

      if (existingPost) {
        // Update existing post
        const { data: updated, error: updateError } = await supabaseService
          .from('blog_posts')
          .update({
            title,
            summary,
            content,
            status: 'published',
            published_at: publishedAt,
            updated_at: publishedAt,
            metadata: { commitHash, generatedAt: publishedAt },
          })
          .eq('id', existingPost.id)
          .select('id')
          .single();

        if (updateError) {
          logger.error({ msg: 'Failed to update release post', error: updateError });
          set.status = 500;
          return { error: 'Failed to update release post' };
        }

        postId = updated.id;
      } else {
        // Create new post
        const postPayload: Record<string, unknown> = {
          slug,
          title,
          summary,
          content,
          status: 'published',
          published_at: publishedAt,
          created_at: publishedAt,
          updated_at: publishedAt,
          metadata: { commitHash, generatedAt: publishedAt },
        };

        // Only set author_id if we have a system author configured
        if (SYSTEM_AUTHOR_ID) {
          postPayload.author_id = SYSTEM_AUTHOR_ID;
        }

        const { data: created, error: createError } = await supabaseService
          .from('blog_posts')
          .insert(postPayload)
          .select('id')
          .single();

        if (createError) {
          logger.error({ msg: 'Failed to create release post', error: createError });
          set.status = 500;
          return { error: 'Failed to create release post' };
        }

        postId = created.id;
      }

      // Link post to release notes category
      if (categoryId) {
        // Remove existing category links and add fresh one
        await supabaseService
          .from('blog_post_categories')
          .delete()
          .eq('post_id', postId);

        await supabaseService
          .from('blog_post_categories')
          .insert({ post_id: postId, category_id: categoryId });
      }

      return {
        success: true,
        postId,
        slug,
        url: `/blog/${slug}`,
        version,
      };
    } catch (err) {
      logger.error({ msg: 'Internal release post error', error: err });
      set.status = 500;
      return { error: 'Internal server error' };
    }
  }, {
    body: t.Object({
      // Used in slug construction — restrict to safe chars
      version: t.String({ minLength: 1, maxLength: 50, pattern: '^[0-9A-Za-z.\\-]+$' }),
      changelog: t.String({ minLength: 1, maxLength: 100_000 }),
      commitHash: t.Optional(t.String({ maxLength: 64, pattern: '^[0-9a-fA-F]+$' })),
    }),
  })

  /**
   * POST /v1/internal/generate-api-key
   * Generate a new API key (admin only endpoint - protected by setup secret)
   */
  .post('/generate-api-key', async ({ request, body, set }) => {
    // This endpoint should be protected in production!
    // Require a setup secret
    const expectedSetupSecret = process.env.BLOG_SETUP_SECRET;
    if (!expectedSetupSecret) {
      set.status = 401;
      return { error: 'Unauthorized' };
    }

    const setupSecret = request.headers.get('x-setup-secret');
    if (setupSecret !== expectedSetupSecret) {
      set.status = 401;
      return { error: 'Unauthorized' };
    }

    const { name, permissions, expiresInDays } = body as {
      name?: string;
      permissions?: string[];
      expiresInDays?: number;
    };

    if (!name || typeof name !== 'string') {
      set.status = 400;
      return { error: 'name is required' };
    }

    if (!permissions || !Array.isArray(permissions)) {
      set.status = 400;
      return { error: 'permissions array is required' };
    }

    const { key, hash } = generateApiKey();

    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
      : null;

    const { data, error } = await supabaseService
      .from('blog_api_keys')
      .insert({
        name,
        key_hash: hash,
        permissions,
        expires_at: expiresAt,
      })
      .select('id, name, permissions, expires_at')
      .single();

    if (error) {
      logger.error({ msg: 'Failed to create API key', error });
      set.status = 500;
      return { error: 'Failed to create API key' };
    }

    set.status = 201;
    return {
      message: 'API key created. Store this key securely - it cannot be retrieved again!',
      key, // Only returned once!
      id: data.id,
      name: data.name,
      permissions: data.permissions,
      expiresAt: data.expires_at,
    };
  }, {
    body: t.Object({
      name: t.String({ minLength: 1, maxLength: 200 }),
      permissions: t.Array(t.String({ minLength: 1, maxLength: 100 }), { maxItems: 50 }),
      expiresInDays: t.Optional(t.Number({ minimum: 1, maximum: 3650 })),
    }),
  });
