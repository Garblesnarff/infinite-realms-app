import { render, screen } from '@testing-library/react';
import React from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CampaignDetailPage from '../CampaignDetailPage';

import type { StarterCampaign } from '@/hooks/use-starter-campaigns';

const state = vi.hoisted(() => ({ campaign: null as StarterCampaign | null }));

vi.mock('@/hooks/use-starter-campaigns', () => ({
  useStarterCampaign: () => ({ campaign: state.campaign, isLoading: false, error: null }),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/features/campaign/components/view/sections/CampaignDetailHero', () => ({
  CampaignDetailHero: () => <div data-testid="hero" />,
}));
vi.mock('@/services/starter-campaign-bootstrap', () => ({
  resolveOrCreateStarterCampaign: vi.fn(),
}));
vi.mock('@/services/user-data-api', () => ({ userDataApi: {} }));

function campaign(overrides: Partial<StarterCampaign>): StarterCampaign {
  return {
    id: 'c1',
    slug: 'the-eternal-feast',
    title: 'The Eternal Feast',
    tagline: null,
    genre: [],
    tone: [],
    difficulty: 'medium',
    levelRange: null,
    estimatedSessions: null,
    premise: 'A banquet that never ends.',
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

function renderPage(): void {
  render(
    <HelmetProvider>
      <MemoryRouter initialEntries={['/explore/the-eternal-feast']}>
        <Routes>
          <Route path="/explore/:slug" element={<CampaignDetailPage />} />
        </Routes>
      </MemoryRouter>
    </HelmetProvider>,
  );
}

describe('CampaignDetailPage "What Awaits You" (#2281)', () => {
  beforeEach(() => {
    state.campaign = null;
  });

  it('fills the section from the first overview section with prose', () => {
    state.campaign = campaign({
      overview:
        '# The Eternal Feast\n\n---\n\n## Campaign Overview\n\nThe guests have been eating for a century.',
    });
    renderPage();

    const heading = screen.getByRole('heading', { name: 'What Awaits You' });
    expect(heading.nextElementSibling).toHaveTextContent(
      'The guests have been eating for a century.',
    );
  });

  it('hides the section when the overview has only a title', () => {
    state.campaign = campaign({ overview: '# The Eternal Feast\n\n## Campaign Overview\n' });
    renderPage();

    expect(screen.getByRole('heading', { name: 'The Story' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'What Awaits You' })).not.toBeInTheDocument();
  });

  it('hides the section when there is no overview', () => {
    state.campaign = campaign({ overview: null });
    renderPage();

    expect(screen.queryByRole('heading', { name: 'What Awaits You' })).not.toBeInTheDocument();
  });

  it('hides "The Story" rather than showing its heading over an empty premise', () => {
    state.campaign = campaign({ premise: '  ', overview: 'An opening line.' });
    renderPage();

    expect(screen.queryByRole('heading', { name: 'The Story' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What Awaits You' })).toBeInTheDocument();
  });
});
