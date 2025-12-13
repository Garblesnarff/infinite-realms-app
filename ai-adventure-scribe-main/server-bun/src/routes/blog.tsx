import { Elysia } from 'elysia';
import { BlogService } from '../../../server/src/services/blog-service.js';
import { getSiteConfig } from '../../../server/src/config/site.js';
import { resolveAssetsForEntries } from '../../../server/src/lib/manifest.js';
import { BlogIndexPage } from '../../../server/src/views/blog/index.js';
import { BlogPostPage } from '../../../server/src/views/blog/post.js';
import { streamReactResponse } from '../utils/react-stream.js';

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
      console.error('Failed to render blog index', error);
      set.status = 500;
      return new Response('Failed to render blog index', {
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
      });
    }
  })
  // Individual blog post by slug
  .get('/:slug', async ({ params, set }) => {
    const { slug } = params;

    try {
      const [post, allPosts, assets] = await Promise.all([
        BlogService.fetchBlogPostBySlug(slug),
        BlogService.fetchPublishedBlogPosts(),
        resolveAssetsForEntries(['index.html', 'src/blog-client.ts']),
      ]);

      if (!post) {
        set.status = 404;
        return new Response('Post not found', {
          status: 404,
          headers: { 'Content-Type': 'text/plain' },
        });
      }

      const site = getSiteConfig();
      const relatedPosts = allPosts.filter((candidate) => candidate.slug !== slug).slice(0, 8);

      const cacheHeaders = createCacheHeaders({ maxAge: 600, staleWhileRevalidate: 3600 });

      return await streamReactResponse(
        <BlogPostPage site={site} assets={assets} post={post} relatedPosts={relatedPosts} />,
        {
          headers: cacheHeaders,
        }
      );
    } catch (error) {
      console.error('Failed to render blog post', error);
      set.status = 500;
      return new Response('Failed to render blog post', {
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
      });
    }
  });
