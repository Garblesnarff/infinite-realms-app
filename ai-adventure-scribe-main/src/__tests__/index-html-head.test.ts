import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
const doc = new DOMParser().parseFromString(html, 'text/html');

function meta(attr: 'property' | 'name', value: string): string | null {
  return doc.querySelector(`meta[${attr}="${value}"]`)?.getAttribute('content') ?? null;
}

function link(rel: string): HTMLLinkElement | null {
  return doc.querySelector(`link[rel="${rel}"]`);
}

describe('index.html share tags', () => {
  it('keeps the existing title and description', () => {
    expect(doc.title).toBe('InfiniteRealms - Your World, Your Story, Forever');
    expect(meta('name', 'description')).toBe(
      'Create persistent worlds that evolve across generations. Build campaigns, characters, and stories that live forever in your own personal universe.',
    );
  });

  it('declares icon, apple-touch-icon, and manifest links', () => {
    const icon = link('icon');
    expect(icon?.getAttribute('href')).toBe('/favicon.ico');
    expect(icon?.getAttribute('sizes')).toBe('any');
    expect(link('apple-touch-icon')?.getAttribute('href')).toBe('/apple-touch-icon.png');
    expect(link('manifest')?.getAttribute('href')).toBe('/site.webmanifest');
    expect(doc.querySelector('link[rel="icon"][sizes="32x32"]')).toBeNull();
  });

  it('declares required Open Graph and Twitter tags with absolute image URLs', () => {
    expect(meta('property', 'og:type')).toBe('website');
    expect(meta('property', 'og:site_name')).toBe('Infinite Realms');
    expect(meta('property', 'og:url')).toBe('https://infiniterealms.app/');
    expect(meta('property', 'og:title')).toBe('Infinite Realms — Your World, Your Story, Forever');
    expect(meta('property', 'og:description')).toBe(
      'Create persistent worlds that evolve across generations. Build campaigns, characters, and stories that live forever in your own personal universe.',
    );
    expect(meta('property', 'og:image:width')).toBe('1200');
    expect(meta('property', 'og:image:height')).toBe('630');
    expect(meta('name', 'twitter:card')).toBe('summary_large_image');
    expect(meta('name', 'twitter:title')).toBe('Infinite Realms — Your World, Your Story, Forever');
    expect(meta('name', 'twitter:description')).toBe(
      'Create persistent worlds that evolve across generations. Build campaigns, characters, and stories that live forever in your own personal universe.',
    );

    const ogImage = meta('property', 'og:image');
    const twitterImage = meta('name', 'twitter:image');
    expect(ogImage).toMatch(/^https:\/\//);
    expect(twitterImage).toMatch(/^https:\/\//);
    expect(ogImage).toBe('https://infiniterealms.app/og-image.png');
    expect(twitterImage).toBe('https://infiniterealms.app/og-image.png');
  });

  it('loads no https scripts from hosts other than infiniterealms.app', () => {
    const foreign = [...doc.querySelectorAll('script[src]')]
      .map((el) => el.getAttribute('src') ?? '')
      .filter((src) => /^https:\/\//i.test(src))
      .filter((src) => {
        const host = new URL(src).hostname;
        return host !== 'infiniterealms.app' && !host.endsWith('.infiniterealms.app');
      });

    expect(foreign).toEqual([]);
  });
});

describe('share asset byte budgets (#226)', () => {
  it('keeps og-image.png under the 200 KB share-card budget', () => {
    const bytes = statSync(join(process.cwd(), 'public', 'og-image.png')).size;
    expect(bytes).toBeLessThan(200_000);
  });

  it('keeps icon-512.png under the 150 KB budget', () => {
    const bytes = statSync(join(process.cwd(), 'public', 'icon-512.png')).size;
    expect(bytes).toBeLessThan(150_000);
  });
});
