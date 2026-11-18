import { render, screen } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ExploreGalleryPage from '../ExploreGalleryPage';

import type { StarterCampaign } from '@/hooks/use-starter-campaigns';

/**
 * #1610 sign-in branch on /explore. Logged out renders the PublicExplore board card; signed in
 * renders the Campaigns board's boxed card (BoxedCampaign). Both use the real cards here, so the
 * assertions read the real copy: "Begin your journey" and "Open the box".
 */
const campaigns = vi.hoisted(() => [] as StarterCampaign[]);
const auth = vi.hoisted(() => ({ user: null as null | { id: string }, loading: false }));

vi.mock('@/hooks/use-starter-campaigns', () => ({
  useStarterCampaigns: () => ({ campaigns, isLoading: false, error: null }),
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => auth,
}));

const campaign = (id: string, title: string): StarterCampaign => ({
  id,
  slug: id,
  title,
  tagline: null,
  genre: ['fantasy'],
  tone: [],
  difficulty: 'Medium',
  levelRange: '1',
  estimatedSessions: '5',
  premise: `${title} premise.`,
  creativeBrief: null,
  overview: null,
  isComplete: true,
  isPublished: true,
  isFeatured: false,
  coverImageUrl: null,
  bannerImageUrl: null,
});

const renderPage = (): ReturnType<typeof render> =>
  render(
    <HelmetProvider>
      <MemoryRouter>
        <ExploreGalleryPage />
      </MemoryRouter>
    </HelmetProvider>,
  );

describe('ExploreGalleryPage sign-in branch (#1610)', () => {
  beforeEach(() => {
    campaigns.splice(0, campaigns.length, campaign('a', 'Alpha'), campaign('b', 'Beta'));
    auth.user = null;
    auth.loading = false;
  });

  it('logged out: renders the PublicExplore card and page chrome, not the boxed card', () => {
    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Explore adventures' })).toBeVisible();
    expect(
      screen.getByText(
        'Ready-made campaigns for one player and an AI Dungeon Master. Pick one and play tonight.',
      ),
    ).toBeVisible();
    expect(screen.getAllByText('Begin your journey')).toHaveLength(2);
    expect(screen.queryByText('Open the box')).not.toBeInTheDocument();
    expect(screen.getByText('More adventures are on the way.')).toBeVisible();
  });

  it('signed in: renders the boxed card (BoxedCampaign), not the public card', () => {
    auth.user = { id: 'player-1' };
    renderPage();

    expect(screen.getAllByText('Open the box')).toHaveLength(2);
    expect(screen.queryByText('Begin your journey')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Explore adventures' })).toBeVisible();
  });

  it('auth still loading: shows the neutral skeleton and neither card layout', () => {
    auth.loading = true;
    renderPage();

    expect(screen.getByRole('status', { name: 'Loading campaigns' })).toBeInTheDocument();
    expect(screen.queryByText('Begin your journey')).not.toBeInTheDocument();
    expect(screen.queryByText('Open the box')).not.toBeInTheDocument();
  });

  it('auth resolves to logged out: the layout switches to the public card with no boxed card left behind', () => {
    auth.loading = true;
    const { rerender } = renderPage();
    expect(screen.queryByText('Begin your journey')).not.toBeInTheDocument();

    auth.loading = false;
    rerender(
      <HelmetProvider>
        <MemoryRouter>
          <ExploreGalleryPage />
        </MemoryRouter>
      </HelmetProvider>,
    );
    expect(screen.getAllByText('Begin your journey')).toHaveLength(2);
    expect(screen.queryByText('Open the box')).not.toBeInTheDocument();
  });
});
