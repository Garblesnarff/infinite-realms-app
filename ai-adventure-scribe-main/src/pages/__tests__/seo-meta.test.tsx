/**
 * #355: page <Helmet> blocks REPLACE the static index.html tags instead of
 * adding second copies — and must never delete tags they don't redeclare.
 *
 * react-helmet-async only manages tags carrying data-rh="true": on every render
 * it deletes all managed tags and inserts the Helmet's declared set. So the
 * static index.html tags the pages override are marked data-rh="true", and
 * EVERY Helmet page redeclares the full set — otherwise visiting the page would
 * wipe e.g. og:image / twitter cards (or everything, on Helmet-less routes).
 *
 * These tests read the real index.html, seed document.head with its data-rh
 * tags, render each page, and assert every seeded tag still exists exactly once
 * (replaced where the page declares it, preserved where it doesn't).
 */
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import indexHtml from '../../../index.html?raw';
import ExploreGalleryPage from '../ExploreGalleryPage';
import LaunchPage from '../LaunchPage';
import PricingPage from '../PricingPage';

// Same mocks the existing page tests use.
vi.mock('@/hooks/use-starter-campaigns', () => ({
  useStarterCampaigns: () => ({ campaigns: [], isLoading: false, error: null }),
}));
vi.mock('@/components/campaigns/StarterCampaignCard', () => ({
  StarterCampaignCard: () => <div data-testid="campaign-card" />,
}));
vi.mock('@/components/launch/StarterCampaignsSection', () => ({
  StarterCampaignsSection: () => null,
}));

/** The data-rh managed tags from the real index.html, as raw tag strings. */
const seedTags = (): string[] => {
  const tags: string[] = [];
  const re = /<(meta|link|title)[^>]*data-rh="true"[^>]*\/?>/g;
  let m: RegExpExecArray | null;
  const html: string = indexHtml;
  while ((m = re.exec(html)) !== null) tags.push(m[0]);
  return tags;
};

/** Stable identity for a head tag: the attribute react-helmet-async manages by. */
const tagKey = (el: Element): string => {
  for (const attr of ['property', 'name', 'rel']) {
    const v = el.getAttribute(attr);
    if (v) return `${el.tagName.toLowerCase()}[${attr}="${v}"]`;
  }
  return el.tagName.toLowerCase();
};

let headSnapshot = '';

beforeEach(() => {
  headSnapshot = document.head.innerHTML;
  const seeds = seedTags();
  expect(seeds.length).toBeGreaterThan(0); // guards a broken index.html read
  const wrap = document.createElement('div');
  wrap.innerHTML = seeds.join('');
  for (const el of Array.from(wrap.children)) document.head.appendChild(el);
});

afterEach(() => {
  document.head.innerHTML = headSnapshot;
});

const renderPage = (page: React.ReactElement): void => {
  render(
    <HelmetProvider>
      <MemoryRouter>{page}</MemoryRouter>
    </HelmetProvider>,
  );
};

/**
 * Every tag index.html marks data-rh must exist exactly once after the page
 * renders — replaced with the page's value where declared, preserved otherwise.
 * Returns the final head tags keyed by identity.
 */
const expectFullTagSet = async (
  expectedTitle: string,
  expectedCanonical: string,
): Promise<Map<string, Element>> => {
  const seeds = seedTags();
  await waitFor(() => {
    const ogTitle = document.head.querySelector('meta[property="og:title"]');
    expect(ogTitle?.getAttribute('content')).toBe(expectedTitle);
  });
  const final = new Map<string, Element>();
  for (const el of Array.from(document.head.querySelectorAll('meta[data-rh], link[data-rh]'))) {
    const key = tagKey(el);
    expect(final.has(key), `duplicate head tag: ${key}`).toBe(false);
    final.set(key, el);
  }
  for (const seed of seeds) {
    const wrap = document.createElement('div');
    wrap.innerHTML = seed;
    const key = tagKey(wrap.children[0]);
    expect(final.has(key), `managed tag deleted by the page: ${key}`).toBe(true);
  }
  const ogTitles = document.head.querySelectorAll('meta[property="og:title"]');
  const descriptions = document.head.querySelectorAll('meta[name="description"]');
  expect(ogTitles).toHaveLength(1);
  expect(descriptions).toHaveLength(1);
  expect(ogTitles[0].getAttribute('content')).toBe(expectedTitle);
  const canonicals = document.head.querySelectorAll('link[rel="canonical"]');
  expect(canonicals).toHaveLength(1);
  expect(canonicals[0].getAttribute('href')).toBe(expectedCanonical);
  return final;
};

describe('SEO meta tags (#355)', () => {
  it('/explore replaces managed tags and deletes none', async () => {
    renderPage(<ExploreGalleryPage />);
    const final = await expectFullTagSet(
      'Explore Adventures | InfiniteRealms',
      'https://infiniterealms.app/explore',
    );
    // Tags /explore does not customize must survive with the static values.
    expect(final.get('meta[property="og:image"]')?.getAttribute('content')).toBe(
      'https://infiniterealms.app/og-image.png',
    );
    expect(final.get('meta[name="twitter:card"]')?.getAttribute('content')).toBe(
      'summary_large_image',
    );
  });

  it('/pricing replaces managed tags and deletes none', async () => {
    renderPage(<PricingPage />);
    const final = await expectFullTagSet(
      'Pricing | Infinite Realms',
      'https://infiniterealms.app/pricing',
    );
    expect(final.get('meta[property="og:image"]')?.getAttribute('content')).toBe(
      'https://infiniterealms.app/og-image.png',
    );
  });

  it('/ replaces managed tags and deletes none', async () => {
    // The Radix checkbox in WaitlistForm measures itself; jsdom has no ResizeObserver.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
    try {
      renderPage(<LaunchPage />);
      const final = await expectFullTagSet(
        'Infinite Realms - Beta Launch | Step into Boundless Worlds of Adventure',
        'https://infiniterealms.app/',
      );
      // LaunchPage customizes the preview image; it must survive as one tag.
      expect(final.get('meta[property="og:image"]')?.getAttribute('content')).toBe(
        'https://infiniterealms.app/og-launch-image.jpg',
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
