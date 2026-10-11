/**
 * #355: page <Helmet> blocks REPLACE the static index.html tags instead of
 * adding second copies.
 *
 * index.html ships static og:* and description tags marked data-rh="true"; when a
 * page renders its <Helmet>, react-helmet-async replaces them (it only manages
 * tags carrying data-rh). These tests seed document.head the way the fixed
 * index.html does and assert each page ends up with exactly one og:title and
 * one description — the page's own, not the static fallback.
 */
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const STATIC = 'STATIC FALLBACK — must be replaced';

const seedStaticHead = (): void => {
  const tags: Array<[string, string, string]> = [
    ['meta', 'name', 'description'],
    ['meta', 'property', 'og:title'],
    ['meta', 'property', 'og:description'],
    ['meta', 'property', 'og:type'],
    ['meta', 'property', 'og:url'],
    ['link', 'rel', 'canonical'],
  ];
  for (const [tag, attr, value] of tags) {
    const el = document.createElement(tag);
    el.setAttribute(attr, value);
    el.setAttribute('data-rh', 'true');
    if (tag === 'meta') el.setAttribute('content', STATIC);
    else el.setAttribute('href', 'https://infiniterealms.app/launch');
    document.head.appendChild(el);
  }
};

let headSnapshot = '';

beforeEach(() => {
  headSnapshot = document.head.innerHTML;
  seedStaticHead();
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

const expectSingleReplacedTags = async (expectedTitle: string): Promise<void> => {
  // Wait for Helmet to commit: the seeded STATIC tag must be gone.
  await waitFor(() => {
    const tags = document.head.querySelectorAll('meta[property="og:title"]');
    expect(tags).toHaveLength(1);
    expect(tags[0].getAttribute('content')).toBe(expectedTitle);
  });
  const ogTitles = document.head.querySelectorAll('meta[property="og:title"]');
  const descriptions = document.head.querySelectorAll('meta[name="description"]');
  const canonicals = document.head.querySelectorAll('link[rel="canonical"]');
  expect(ogTitles).toHaveLength(1);
  expect(descriptions).toHaveLength(1);
  expect(canonicals).toHaveLength(1);
  expect(ogTitles[0].getAttribute('content')).toBe(expectedTitle);
  expect(ogTitles[0].getAttribute('content')).not.toBe(STATIC);
  expect(descriptions[0].getAttribute('content')).not.toBe(STATIC);
};

describe('SEO meta tags (#355)', () => {
  it('/explore ends up with exactly one og:title and one description', async () => {
    renderPage(<ExploreGalleryPage />);
    await expectSingleReplacedTags('Explore Adventures | InfiniteRealms');
    const canonical = document.head.querySelector('link[rel="canonical"]');
    expect(canonical?.getAttribute('href')).toBe('https://infiniterealms.app/explore');
  });

  it('/pricing ends up with exactly one og:title and one description', async () => {
    renderPage(<PricingPage />);
    await expectSingleReplacedTags('Pricing | Infinite Realms');
    const canonical = document.head.querySelector('link[rel="canonical"]');
    expect(canonical?.getAttribute('href')).toBe('https://infiniterealms.app/pricing');
  });

  it('/ ends up with exactly one og:title and one description', async () => {
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
      await expectSingleReplacedTags(
        'Infinite Realms - Beta Launch | Step into Boundless Worlds of Adventure',
      );
      // The /launch -> / canonical fix: / renders the launch page, so its
      // canonical is the site root, not /launch.
      const canonical = document.head.querySelector('link[rel="canonical"]');
      expect(canonical?.getAttribute('href')).toBe('https://infiniterealms.app/');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
