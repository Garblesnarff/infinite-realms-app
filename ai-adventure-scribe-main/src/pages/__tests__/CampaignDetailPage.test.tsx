import { render, screen } from '@testing-library/react';
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

describe('CampaignDetailPage level and length labels (#829)', () => {
  beforeEach(() => {
    state.campaign = null;
  });

  // Fixture follows the real producers: parseOverview stores levelRange
  // "3-3" (Start 3 → Finish 3) and, today, estimatedSessions "2-4" — the
  // hours range of the one-shot line — and mapCampaignRow carries the raw
  // overview onto the campaign object.
  it('shows Level 3 and "One-shot (2–4 hours)" for a level-3 one-shot', () => {
    state.campaign = campaign({
      levelRange: '3-3',
      estimatedSessions: '2-4',
      overview: [
        '# Twelve Bells',
        '',
        '**Player Level Range:** Start **3** → Finish **3**',
        '',
        '**Estimated Length:** One-shot — 1 session (2–4 hours)',
        '',
        '## Campaign Overview',
        '',
        'The bell tolls for the village.',
      ].join('\n'),
    });
    renderPage();

    expect(screen.getByText('Level 3')).toBeInTheDocument();
    expect(screen.getByText('One-shot (2–4 hours)')).toBeInTheDocument();
    expect(screen.queryByText('2-4 sessions')).not.toBeInTheDocument();
  });

  it('keeps the level-1 full campaign labels byte-identical', () => {
    state.campaign = campaign({
      levelRange: '1-5',
      estimatedSessions: '8-12',
      overview: [
        '# The Eternal Feast',
        '',
        '**Player Level Range:** Start **1** → Finish **5**',
        '',
        '**Estimated Length:** 8-12 sessions',
        '',
        '## Campaign Overview',
        '',
        'The guests have been eating for a century.',
      ].join('\n'),
    });
    renderPage();

    expect(screen.getByText('Level 1-5')).toBeInTheDocument();
    expect(screen.getByText('8-12 sessions')).toBeInTheDocument();
  });
});
