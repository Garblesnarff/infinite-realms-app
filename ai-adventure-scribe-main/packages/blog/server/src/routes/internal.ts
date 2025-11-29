import { Router } from 'express';
import { supabaseService } from '../lib/supabase.js';
import { requireApiKey, hasPermission, generateApiKey } from '../middleware/api-key.js';
import type { Request, Response } from 'express';

const router = Router();

const RELEASE_NOTES_CATEGORY_SLUG = 'release-notes';
const SYSTEM_AUTHOR_ID = process.env.BLOG_SYSTEM_AUTHOR_ID || null;

/**
 * POST /internal/release-post
 *
 * Create and publish a blog post for a release.
 * Used by GitHub Actions workflow for automated changelog posts.
 *
 * Required permission: create_release_post
 *
 * Body: {
 *   version: string;      // e.g., "0.10.1"
 *   changelog: string;    // Markdown changelog content
 *   commitHash?: string;  // Git commit hash
 * }
 */
router.post(
  '/release-post',
  requireApiKey,
  hasPermission('create_release_post'),
  async (req: Request, res: Response) => {
    try {
      const { version, changelog, commitHash } = req.body;

      if (!version || typeof version !== 'string') {
        return res.status(400).json({ error: 'version is required' });
      }

      if (!changelog || typeof changelog !== 'string') {
        return res.status(400).json({ error: 'changelog is required' });
      }

      const slug = `release-v${version.replace(/\./g, '-')}`;
      const title = `v${version} Release Notes`;
      const publishedAt = new Date().toISOString();

      // Build the blog post content
      const content = buildReleasePostContent(version, changelog, commitHash);
      const summary = buildReleaseSummary(version, changelog);

      // Check if release notes category exists, create if not
      let categoryId = await getOrCreateCategory();

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
          console.error('Failed to update release post:', updateError);
          return res.status(500).json({ error: 'Failed to update release post' });
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
          console.error('Failed to create release post:', createError);
          return res.status(500).json({ error: 'Failed to create release post' });
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

      return res.status(200).json({
        success: true,
        postId,
        slug,
        url: `/blog/${slug}`,
        version,
      });
    } catch (err) {
      console.error('Internal release post error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * POST /internal/generate-api-key
 *
 * Generate a new API key (admin only endpoint - protect this!)
 * This should only be called during initial setup or via secure admin panel.
 *
 * Body: {
 *   name: string;          // Descriptive name
 *   permissions: string[]; // e.g., ['create_release_post']
 *   expiresInDays?: number;
 * }
 */
router.post('/generate-api-key', async (req: Request, res: Response) => {
  // This endpoint should be protected in production!
  // For now, require a setup secret
  const setupSecret = req.headers['x-setup-secret'];
  if (setupSecret !== process.env.BLOG_SETUP_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { name, permissions, expiresInDays } = req.body;

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'name is required' });
  }

  if (!permissions || !Array.isArray(permissions)) {
    return res.status(400).json({ error: 'permissions array is required' });
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
    console.error('Failed to create API key:', error);
    return res.status(500).json({ error: 'Failed to create API key' });
  }

  return res.status(201).json({
    message: 'API key created. Store this key securely - it cannot be retrieved again!',
    key, // Only returned once!
    id: data.id,
    name: data.name,
    permissions: data.permissions,
    expiresAt: data.expires_at,
  });
});

// Helper functions

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
    console.error('Failed to create release-notes category:', error);
    return null;
  }

  return created.id;
}

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

function buildReleaseSummary(version: string, changelog: string): string {
  // Extract first paragraph or first 200 chars
  const lines = changelog.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  const firstParagraph = lines[0] || '';

  if (firstParagraph.length > 200) {
    return firstParagraph.slice(0, 197) + '...';
  }

  return firstParagraph || `Release notes for version ${version}`;
}

export default router;
