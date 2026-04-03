import { Elysia } from 'elysia';

import { getSiteConfig } from '../config/site.js';
import { logger } from '../lib/logger.js';
import { BlogService } from '../services/blog-service.js';

type BlogPosts = Awaited<ReturnType<typeof BlogService.fetchPublishedBlogPosts>>;

/**
 * Build XML sitemap from site config and blog posts
 */
function buildSitemap(siteUrl: string, posts: BlogPosts): string {
  const urls: string[] = [];

  // Static pages - landing pages have higher priority
  const landingPages = ['/', '/ai-game-master', '/solo-tabletop-rpg'];
  const otherPages = ['/blog', '/rss.xml'];

  // Add landing pages with priority
  landingPages.forEach((path) => {
    urls.push(renderSitemapUrl(`${siteUrl}${path === '/' ? '' : path}`, undefined, '0.9'));
  });

  // Add other static pages
  otherPages.forEach((path) => {
    urls.push(renderSitemapUrl(`${siteUrl}${path}`, undefined));
  });

  // Add blog posts
  posts.forEach((post) => {
    urls.push(renderSitemapUrl(`${siteUrl}/blog/${post.slug}`, post.updatedAt ?? post.publishedAt));
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`;
}

/**
 * Render a single sitemap URL entry
 */
function renderSitemapUrl(loc: string, lastMod?: string, priority?: string): string {
  const lastmodTag = lastMod ? `<lastmod>${escapeXml(new Date(lastMod).toISOString())}</lastmod>` : '';
  const priorityTag = priority ? `<priority>${priority}</priority>` : '';
  return `<url><loc>${escapeXml(loc)}</loc>${lastmodTag}${priorityTag}</url>`;
}

/**
 * Build RSS 2.0 feed from blog posts
 */
function buildRssFeed(
  siteUrl: string,
  siteName: string,
  siteDescription: string,
  posts: BlogPosts
): string {
  const items = posts.map((post) => {
    const link = `${siteUrl}/blog/${post.slug}`;
    const description = post.summary ?? post.excerpt ?? '';
    return `<item>
<title>${escapeXml(post.title)}</title>
<link>${escapeXml(link)}</link>
<guid>${escapeXml(link)}</guid>
<pubDate>${escapeXml(new Date(post.publishedAt).toUTCString())}</pubDate>
<description>${escapeCdata(description)}</description>
<content:encoded><![CDATA[${post.html}]]></content:encoded>
</item>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(siteName)} Blog</title>
    <link>${escapeXml(`${siteUrl}/blog`)}</link>
    <description>${escapeXml(siteDescription)}</description>
    <language>en-us</language>
    <generator>Infinite Realms SSR</generator>
    <atom:link href="${escapeXml(`${siteUrl}/rss.xml`)}" rel="self" type="application/rss+xml" />
    ${items.join('\n    ')}
  </channel>
</rss>`;
}

/**
 * Escape special characters for XML
 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escape CDATA end markers
 */
function escapeCdata(value: string): string {
  return value.replace(/]]>/g, ']]]]><![CDATA[>');
}

/**
 * SEO routes for sitemap, robots.txt, and RSS feed
 *
 * Migrated from Express to Elysia
 */
export const seoRoutes = new Elysia()
  // XML Sitemap
  .get('/sitemap.xml', async ({ set }) => {
    try {
      const site = getSiteConfig();
      const posts = await BlogService.fetchPublishedBlogPosts();
      const xml = buildSitemap(site.url, posts);

      set.headers['Content-Type'] = 'application/xml';
      set.headers['Cache-Control'] = 'public, max-age=3600, stale-while-revalidate=86400';

      return xml;
    } catch (error) {
      logger.error({ msg: 'Failed to generate sitemap', error });
      set.status = 500;
      return 'Unable to generate sitemap';
    }
  })
  // RSS Feed
  .get('/rss.xml', async ({ set }) => {
    try {
      const site = getSiteConfig();
      const posts = await BlogService.fetchPublishedBlogPosts();
      const rss = buildRssFeed(site.url, site.name, site.description, posts);

      set.headers['Content-Type'] = 'application/rss+xml; charset=utf-8';
      set.headers['Cache-Control'] = 'public, max-age=1800, stale-while-revalidate=43200';

      return rss;
    } catch (error) {
      logger.error({ msg: 'Failed to generate RSS feed', error });
      set.status = 500;
      return 'Unable to generate RSS feed';
    }
  })
  // Robots.txt
  .get('/robots.txt', ({ set }) => {
    const site = getSiteConfig();
    const body = [
      'User-agent: *',
      'Allow: /',
      `Sitemap: ${site.url}/sitemap.xml`,
      `Host: ${site.url}`,
      '',
      '# LLM Documentation Index',
      '# See https://llmstxt.org for specification',
      `Llms-txt: ${site.url}/llms.txt`,
    ].join('\n');

    set.headers['Content-Type'] = 'text/plain';
    set.headers['Cache-Control'] = 'public, max-age=86400, stale-while-revalidate=604800';

    return body;
  });
