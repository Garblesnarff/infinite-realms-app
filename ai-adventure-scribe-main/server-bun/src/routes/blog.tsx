import { Elysia } from 'elysia';

import { getSiteConfig } from '../config/site.js';
import { logger } from '../lib/logger.js';
import { resolveAssetsForEntries } from '../lib/manifest.js';
import { BlogService } from '../services/blog-service.js';
import { streamReactResponse } from '../utils/react-stream.js';
import { BlogIndexPage } from '../views/blog/index.js';
import { BlogPostPage } from '../views/blog/post.js';

/**
 * Check if request accepts Markdown content
 */
function wantsMarkdown(request: Request): boolean {
  const accept = request.headers.get('accept') || '';
  return accept.includes('text/markdown');
}

/**
 * Generate Markdown response for a blog post
 * Prepends llms.txt discovery instruction per Mintlify pattern
 */
function generateMarkdownResponse(
  post: { title: string; markdown: string; publishedAt: string; slug: string },
  siteUrl: string
): string {
  const discovery = `> ## Documentation Index
> Fetch the complete documentation index at: ${siteUrl}/llms.txt
> Use this file to discover all available pages before exploring further.

`;
  return `${discovery}# ${post.title}

*Published: ${new Date(post.publishedAt).toLocaleDateString()}*

${post.markdown}
`;
}

/**
 * Create cache control headers for SSR pages
 */
function createCacheHeaders({
  maxAge,
  staleWhileRevalidate,
}: {
  maxAge: number;
  staleWhileRevalidate: number;
}) {
  const directive = `public, max-age=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`;
  return {
    'Cache-Control': directive,
    'CDN-Cache-Control': directive,
    'Vercel-CDN-Cache-Control': directive,
    'Surrogate-Control': directive,
    Vary: 'Accept-Encoding, Accept-Language',
  };
}

/**
 * Blog routes for SSR
 *
 * Migrated from Express to Elysia using Web Streams (renderToReadableStream)
 */
export const blogRoutes = new Elysia({ prefix: '/blog' })
  // Blog index page - list all published posts
  .get('/', async ({ set }) => {
    try {
      const [posts, assets] = await Promise.all([
        BlogService.fetchPublishedBlogPosts(),
        resolveAssetsForEntries(['index.html', 'src/blog-client.ts']),
      ]);
      const site = getSiteConfig();

      const cacheHeaders = createCacheHeaders({ maxAge: 300, staleWhileRevalidate: 1800 });

      return await streamReactResponse(
        <BlogIndexPage site={site} assets={assets} posts={posts} />,
        {
          headers: cacheHeaders,
        }
      );
    } catch (error) {
      // ⚡ Bolt: Use non-blocking structured logger for better performance and observability
      logger.error('Failed to render blog index', { error });
      set.status = 500;
      return new Response('Failed to render blog index', {
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
      });
    }
  })
  // Individual blog post by slug
  .get('/:slug', async ({ params, set, request }) => {
    const { slug } = params;

    try {
      const post = await BlogService.fetchBlogPostBySlug(slug);

      if (!post) {
        set.status = 404;
        return new Response('Post not found', {
          status: 404,
          headers: { 'Content-Type': 'text/plain' },
        });
      }

      const site = getSiteConfig();

      // Content negotiation: serve Markdown for AI agents
      if (wantsMarkdown(request)) {
        const markdownContent = generateMarkdownResponse(post, site.url);

        set.headers['Content-Type'] = 'text/markdown; charset=utf-8';
        set.headers['Cache-Control'] = 'public, max-age=600, stale-while-revalidate=3600';
        set.headers['X-Robots-Tag'] = 'noindex, nofollow';
        set.headers['Link'] = '</llms.txt>; rel="llms-txt"';
        set.headers['X-Llms-Txt'] = '/llms.txt';

        return markdownContent;
      }

      // Standard HTML response for browsers
      const [relatedPosts, assets] = await Promise.all([
        BlogService.fetchRecentBlogPosts(slug, 8),
        resolveAssetsForEntries(['index.html', 'src/blog-client.ts']),
      ]);

      const cacheHeaders = createCacheHeaders({ maxAge: 600, staleWhileRevalidate: 3600 });

      return await streamReactResponse(
        <BlogPostPage site={site} assets={assets} post={post} relatedPosts={relatedPosts} />,
        {
          headers: cacheHeaders,
        }
      );
    } catch (error) {
      // ⚡ Bolt: Use non-blocking structured logger for better performance and observability
      logger.error('Failed to render blog post', { error });
      set.status = 500;
      return new Response('Failed to render blog post', {
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
      });
    }
  });
