/**
 * #355 (AU-19/20): the blog's canonical must point at the blog's final URL.
 * `/blog` 301s to `blog.infiniterealms.app`, so a canonical of
 * `https://infiniterealms.app/blog` points at a redirect. The blog views must
 * emit `https://blog.infiniterealms.app` (and `…/{slug}` for posts).
 */
import { describe, expect, it } from 'bun:test';
import { renderToString } from 'react-dom/server';

import { getSiteConfig } from '../../../config/site.js';
import { BlogIndexPage } from '../index.js';
import { BlogPostPage } from '../post.js';

const post = {
  slug: 'getting-started',
  title: 'Getting Started',
  excerpt: 'An excerpt.',
  publishedAt: '2026-01-01',
  updatedAt: '2026-01-02',
  tags: [],
  categories: [],
  authorName: 'Test',
  coverImageUrl: null,
} as any;

describe('blog canonical URLs (#355)', () => {
  it('getSiteConfig exposes the blog base URL, defaulting to the subdomain', () => {
    delete process.env.BLOG_BASE_URL;
    expect(getSiteConfig().blogUrl).toBe('https://blog.infiniterealms.app');
    process.env.BLOG_BASE_URL = 'https://blog.example.test/';
    expect(getSiteConfig().blogUrl).toBe('https://blog.example.test');
    delete process.env.BLOG_BASE_URL;
  });

  it('the blog index canonical is the blog root, not the redirecting /blog path', () => {
    const html = renderToString(
      <BlogIndexPage site={getSiteConfig()} assets={null} posts={[]} />,
    );
    expect(html).toContain('<link rel="canonical" href="https://blog.infiniterealms.app"/>');
    expect(html).not.toContain('infiniterealms.app/blog"');
  });

  it('a post canonical is the post URL on the blog host', () => {
    const html = renderToString(
      <BlogPostPage site={getSiteConfig()} assets={null} post={post} relatedPosts={[]} />,
    );
    expect(html).toContain(
      '<link rel="canonical" href="https://blog.infiniterealms.app/getting-started"/>',
    );
    expect(html).not.toContain('infiniterealms.app/blog/getting-started');
  });
});