import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';

import { getSiteConfig } from '../../config/site.js';
import { createPublicMetaRoutes, injectPublicMeta, PUBLIC_PAGE_METAS } from '../public-meta.js';

// public-meta.ts reads no services at import time, so no mocks are needed.
// The route reads dist/index.html; tests inject the repo's index.html instead
// of requiring a production build.
const REPO_INDEX = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'index.html'),
  'utf8',
);

async function getPage(routePath: string): Promise<{ res: Response; html: string }> {
  const app = createPublicMetaRoutes({ readClientIndex: () => REPO_INDEX });
  const res = await app.handle(new Request(`http://localhost${routePath}`));
  return { res, html: await res.text() };
}

describe('injectPublicMeta (#227 AU-06)', () => {
  it('replaces the landing title, description, and og tags with the page meta', () => {
    const siteUrl = getSiteConfig().url;
    const html = injectPublicMeta(REPO_INDEX, PUBLIC_PAGE_METAS[0], siteUrl);

    expect(html).toContain('<title>Pricing | Infinite Realms</title>');
    expect(html).toContain(
      '<meta name="description" content="No credit card to start. Cancel Legend any time.">',
    );
    expect(html).toContain('<meta property="og:title" content="Pricing | Infinite Realms">');
    expect(html).toContain(`<meta property="og:url" content="${siteUrl}/pricing">`);
    expect(html).toContain(`<link rel="canonical" href="${siteUrl}/pricing">`);
    // The landing page's own tags are gone.
    expect(html).not.toContain('<title>InfiniteRealms - Your World, Your Story, Forever</title>');
    expect(html).not.toContain('content="https://infiniterealms.app/"');
  });

  it('leaves an existing canonical link alone', () => {
    const withCanonical = REPO_INDEX.replace(
      '</head>',
      '<link rel="canonical" href="https://example.com/old">\n</head>',
    );
    const html = injectPublicMeta(withCanonical, PUBLIC_PAGE_METAS[1], getSiteConfig().url);
    expect(html).toContain('href="https://example.com/old"');
    expect(html.match(/rel="canonical"/g)).toHaveLength(1);
  });
});

describe('GET /pricing, /contact, /privacy, /terms (#227 AU-06)', () => {
  it.each([
    ['/pricing', 'Pricing | Infinite Realms'],
    ['/contact', 'Contact | Infinite Realms'],
    ['/privacy', 'Privacy Policy | Infinite Realms'],
    ['/terms', 'Terms of Service | Infinite Realms'],
  ])('%s serves index.html with its own title', async (routePath, title) => {
    const { res, html } = await getPage(routePath);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(html).toContain(`<title>${title}</title>`);
  });

  it('does not leak the landing page description into the page html', async () => {
    const { html } = await getPage('/privacy');
    expect(html).not.toContain('Create persistent worlds that evolve across generations');
  });

  it('serves the trailing-slash variant with the same meta', async () => {
    const { res, html } = await getPage('/pricing/');

    expect(res.status).toBe(200);
    expect(html).toContain('<title>Pricing | Infinite Realms</title>');
    expect(html).toContain(`<link rel="canonical" href="${getSiteConfig().url}/pricing">`);
  });

  it('keeps the pricing description in sync with the client copy (#227)', () => {
    // The server cannot import the client's launchPageContent (it pulls in
    // react), so this reads the source text. If the regex stops matching, the
    // copy moved — update both.
    const clientSource = readFileSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '..',
        '..',
        '..',
        '..',
        'src',
        'data',
        'launchPageContent.ts',
      ),
      'utf8',
    );
    const match = clientSource.match(/pricing:\s*\{[^}]*subtitle:\s*'([^']+)'/);
    expect(match, 'pricing subtitle not found in launchPageContent.ts').not.toBeNull();
    const pricingMeta = PUBLIC_PAGE_METAS.find((meta) => meta.path === '/pricing');
    expect(pricingMeta?.description).toBe(match?.[1]);
  });
});
