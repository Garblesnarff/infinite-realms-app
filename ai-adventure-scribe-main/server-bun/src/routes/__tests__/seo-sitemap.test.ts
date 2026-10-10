import { describe, expect, it, mock } from 'bun:test';

import { getSiteConfig } from '../../config/site.js';
import { createRequestPipelineApp } from '../../http-pipeline.js';

// seo.ts imports the blog service, which creates a Supabase client at import time. The sitemap
// no longer reads posts, and the RSS feed is not under test, so the service is stubbed.
mock.module('../../services/blog-service.js', () => ({
  BlogService: { fetchPublishedBlogPosts: async () => [] },
}));

const { seoRoutes } = await import('../seo.js');

// #227. The sitemap lists final URLs on this host. /blog and its posts 301 to
// blog.infiniterealms.app, so they must not appear, and /pricing must.

async function getSitemap(): Promise<{ res: Response; xml: string }> {
  const app = createRequestPipelineApp().use(seoRoutes);
  const res = await app.handle(new Request('http://localhost/sitemap.xml'));
  return { res, xml: await res.text() };
}

describe('GET /sitemap.xml (#227)', () => {
  it('lists the pricing page and the landing pages', async () => {
    const { res, xml } = await getSitemap();

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/xml');
    const siteUrl = getSiteConfig().url;
    expect(xml).toContain(`<loc>${siteUrl}/pricing</loc>`);
    expect(xml).toContain(`<loc>${siteUrl}/ai-game-master</loc>`);
    expect(xml).toContain(`<loc>${siteUrl}/solo-tabletop-rpg</loc>`);
  });

  it('does not list /blog URLs, which redirect to the blog subdomain', async () => {
    const { xml } = await getSitemap();

    expect(xml).not.toContain('/blog');
  });
});
