/**
 * LandingCampaigns — reserved height while loading (#1432 item 5).
 *
 * While the starter campaigns are loading, the section renders its shell with
 * skeleton cards in place of the campaign cards, so the page does not jump
 * when the campaigns arrive. Loaded and empty still renders nothing.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LandingCampaigns } from '../LandingCampaigns';

import type { StarterCampaign } from '@/hooks/use-starter-campaigns';

const mockUseStarterCampaigns = vi.fn();
vi.mock('@/hooks/use-starter-campaigns', () => ({
  useStarterCampaigns: () => mockUseStarterCampaigns(),
}));

beforeEach(() => {
  mockUseStarterCampaigns.mockClear();
});

// Fixture follows the real producer: mapCampaignRow in
// src/hooks/use-starter-campaigns.ts maps a Supabase row to this shape.
function campaign(overrides: Partial<StarterCampaign> = {}): StarterCampaign {
  return {
    id: 'c1',
    slug: 'the-eternal-feast',
    title: 'The Eternal Feast',
    tagline: null,
    genre: ['Fantasy'],
    tone: [],
    difficulty: 'medium',
    levelRange: null,
    estimatedSessions: null,
    premise: 'A feast that never ends.',
    creativeBrief: null,
    overview: null,
    isComplete: true,
    isPublished: true,
    isFeatured: false,
    coverImageUrl: null,
    bannerImageUrl: null,
    ...overrides,
  };
}

const renderRow = (): ReturnType<typeof render> =>
  render(
    <MemoryRouter>
      <LandingCampaigns />
    </MemoryRouter>,
  );

describe('LandingCampaigns', () => {
  it('reserves its height while loading: skeleton, no campaign links', () => {
    mockUseStarterCampaigns.mockReturnValue({
      campaigns: [],
      featuredCampaigns: [],
      isLoading: true,
      error: null,
    });

    const { container } = renderRow();

    expect(screen.getByText('Start a story tonight')).toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    const skeleton = screen.getByTestId('landing-campaigns-skeleton');
    const skeletonItems = skeleton.querySelectorAll(':scope > li');
    expect(skeletonItems).toHaveLength(3);
    for (const item of skeletonItems) {
      expect(item.firstElementChild?.className).toContain('aspect-square');
      expect(item.firstElementChild?.className).toContain('max-w-[400px]');
    }
    expect(screen.getByRole('link', { name: /see all adventures/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /difficulty/i })).toBeNull();
  });

  it('replaces the skeleton with the real campaign cards when loaded', () => {
    mockUseStarterCampaigns.mockReturnValue({
      campaigns: [
        campaign(),
        campaign({ id: 'c2', slug: 'abyssal-descent', title: 'Abyssal Descent' }),
        campaign({ id: 'c3', slug: 'arcane-gastronomy', title: 'Academy of Arcane Gastronomy' }),
      ],
      featuredCampaigns: [],
      isLoading: false,
      error: null,
    });

    const { container } = renderRow();

    expect(screen.queryByTestId('landing-campaigns-skeleton')).toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    for (const chip of screen.getAllByText('Medium')) {
      expect(chip).not.toHaveClass('uppercase');
      expect(chip).toHaveTextContent('Medium');
    }
    expect(screen.getByRole('link', { name: /the eternal feast/i })).toHaveAttribute(
      'href',
      '/explore/the-eternal-feast',
    );
    expect(screen.getByRole('link', { name: /abyssal descent/i })).toHaveAttribute(
      'href',
      '/explore/abyssal-descent',
    );
    expect(screen.getByRole('link', { name: /academy of arcane gastronomy/i })).toHaveAttribute(
      'href',
      '/explore/arcane-gastronomy',
    );
  });

  it('prefers featured campaigns over the full list when loaded', () => {
    mockUseStarterCampaigns.mockReturnValue({
      campaigns: [
        campaign({ id: 'c1', slug: 'the-eternal-feast', title: 'The Eternal Feast' }),
        campaign({ id: 'c2', slug: 'abyssal-descent', title: 'Abyssal Descent' }),
      ],
      featuredCampaigns: [
        campaign({
          id: 'f1',
          slug: 'featured-one',
          title: 'Featured One',
          isFeatured: true,
        }),
      ],
      isLoading: false,
      error: null,
    });

    renderRow();

    expect(
      screen.getByRole('link', { name: /featured one, medium difficulty/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /the eternal feast/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /abyssal descent/i })).toBeNull();
    expect(screen.queryByTestId('landing-campaigns-skeleton')).toBeNull();
  });

  it('renders nothing when loaded and empty', () => {
    mockUseStarterCampaigns.mockReturnValue({
      campaigns: [],
      featuredCampaigns: [],
      isLoading: false,
      error: null,
    });

    const { container } = renderRow();

    expect(container.firstChild).toBeNull();
  });
});
