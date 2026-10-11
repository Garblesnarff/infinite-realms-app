import { readFileSync } from 'node:fs';
import path from 'node:path';

import { Elysia } from 'elysia';

import { getSiteConfig } from '../config/site.js';
import { logger } from '../lib/logger.js';

export interface PublicPageMeta {
  /** Route path, e.g. '/pricing'. */
  path: string;
  title: string;
  description: string;
}

/**
 * Per-page meta for the public SPA routes (#227 AU-06). nginx serves
 * dist/index.html for these paths, so crawlers see the landing page's title
 * and description. These routes serve the same index.html with the head tags
 * replaced, the way the SSR SEO pages inject their meta. nginx must proxy
 * these exact paths to the backend (see nginx.conf.example); the live box
 * change needs Rob's line.
 */
export const PUBLIC_PAGE_METAS: PublicPageMeta[] = [
  {
    path: '/pricing',
    title: 'Pricing | Infinite Realms',
    // Mirrors launchPageContent.pricing.subtitle on the client
    // (src/data/launchPageContent.ts); keep in sync.
    description: 'No credit card to start. Cancel Legend any time.',
  },
  {
    path: '/contact',
    title: 'Contact | Infinite Realms',
    description: 'Contact the Infinite Realms team for support, feedback, or press inquiries.',
  },
  {
    path: '/privacy',
    title: 'Privacy Policy | Infinite Realms',
    description: 'How Infinite Realms collects, uses, and protects your personal data.',
  },
  {
    path: '/terms',
    title: 'Terms of Service | Infinite Realms',
    description: 'The terms of service governing your use of Infinite Realms.',
  },
];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Replace the landing page's head tags in the served index.html with the
 * page's own meta, and add a canonical link (index.html has none).
 * Pure function over strings so tests don't need a dist build.
 */
export function injectPublicMeta(html: string, meta: PublicPageMeta, siteUrl: string): string {
  const canonical = `${siteUrl}${meta.path}`;
  // index.html self-closes void tags (`content="..." />`); tolerate both forms.
  const metaTag = (name: string): RegExp => new RegExp(`<meta ${name} content=".*?\\s*/?>`);
  // Replacement functions (not strings): a `$` in future copy would otherwise
  // be read as a `$&`/`$'` substitution pattern by String.replace.
  const title = (): string => `<title>${escapeHtml(meta.title)}</title>`;
  const description = (): string =>
    `<meta name="description" content="${escapeHtml(meta.description)}">`;
  const ogTitle = (): string => `<meta property="og:title" content="${escapeHtml(meta.title)}">`;
  const ogDescription = (): string =>
    `<meta property="og:description" content="${escapeHtml(meta.description)}">`;
  const ogUrl = (): string => `<meta property="og:url" content="${escapeHtml(canonical)}">`;
  const twitterTitle = (): string =>
    `<meta name="twitter:title" content="${escapeHtml(meta.title)}">`;
  const twitterDescription = (): string =>
    `<meta name="twitter:description" content="${escapeHtml(meta.description)}">`;
  let out = html.replace(/<title>.*?<\/title>/, title);
  out = out.replace(metaTag('name="description"'), description);
  out = out.replace(metaTag('property="og:title"'), ogTitle);
  out = out.replace(metaTag('property="og:description"'), ogDescription);
  out = out.replace(metaTag('property="og:url"'), ogUrl);
  out = out.replace(metaTag('name="twitter:title"'), twitterTitle);
  out = out.replace(metaTag('name="twitter:description"'), twitterDescription);
  if (!/<link rel="canonical"/.test(out)) {
    out = out.replace('</head>', `<link rel="canonical" href="${escapeHtml(canonical)}">\n</head>`);
  }
  return out;
}

export interface PublicMetaSources {
  /** Returns the served index.html; throws if it can't be read. */
  readClientIndex?: () => string;
}

/** pm2 runs the server from `<app>/server-bun`; nginx serves `<app>/dist`. */
function defaultReadClientIndex(): string {
  const file =
    process.env.CLIENT_INDEX_HTML || path.resolve(process.cwd(), '..', 'dist', 'index.html');
  return readFileSync(file, 'utf8');
}

export function createPublicMetaRoutes(sources: PublicMetaSources = {}) {
  const readClientIndex = sources.readClientIndex ?? defaultReadClientIndex;
  const app = new Elysia();
  for (const meta of PUBLIC_PAGE_METAS) {
    // Trailing-slash variant serves the same meta (canonical stays slashless).
    for (const routePath of [meta.path, `${meta.path}/`]) {
      app.get(routePath, ({ set }) => {
        try {
          const site = getSiteConfig();
          const html = injectPublicMeta(readClientIndex(), meta, site.url);
          set.headers['Content-Type'] = 'text/html; charset=utf-8';
          // Entry HTML must never be cached: a stale copy references chunk
          // hashes a later deploy has already deleted (same rule as the SPA
          // fallback's index.html in nginx.conf.example).
          set.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
          return html;
        } catch (error) {
          logger.error({ error }, `Failed to serve ${meta.path} with injected meta`);
          return new Response('Failed to render page', { status: 500 });
        }
      });
    }
  }
  return app;
}

export const publicMetaRoutes = createPublicMetaRoutes();
