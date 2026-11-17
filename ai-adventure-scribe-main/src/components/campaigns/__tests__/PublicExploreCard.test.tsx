import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { PublicExploreCard } from '../PublicExploreCard';

import type { StarterCampaign } from '@/hooks/use-starter-campaigns';

const campaign: StarterCampaign = {
  id: 'c1',
  slug: 'abyssal-descent',
  title: 'Abyssal Descent',
  tagline: null,
  genre: ['horror', 'survival'],
  tone: [],
  difficulty: 'hard',
  levelRange: '1',
  estimatedSessions: '10–15',
  premise: 'The party joins an expedition down the Infinite Chasm.',
  creativeBrief: null,
  overview: null,
  isComplete: true,
  isPublished: true,
  isFeatured: false,
  coverImageUrl: null,
  bannerImageUrl: null,
};

const renderCard = (overrides: Partial<StarterCampaign> = {}): ReturnType<typeof render> =>
  render(
    <MemoryRouter>
      <PublicExploreCard campaign={{ ...campaign, ...overrides }} />
    </MemoryRouter>,
  );

describe('PublicExploreCard (#1610, PublicExplore board card)', () => {
  it('links to the campaign', () => {
    renderCard();
    const link = screen.getByRole('link', { name: /Abyssal Descent/ });
    expect(link).toHaveAttribute('href', '/explore/abyssal-descent');
  });

  it('shows the board copy: title, hook, level and sessions, and the call to action', () => {
    renderCard();
    expect(screen.getByRole('heading', { level: 2, name: 'Abyssal Descent' })).toBeInTheDocument();
    expect(
      screen.getByText('The party joins an expedition down the Infinite Chasm.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Level 1 · 10–15 sessions')).toBeInTheDocument();
    expect(screen.getByText('Begin your journey')).toBeInTheDocument();
  });

  it('uses the board navy card and gold accents, not the boxed parchment card', () => {
    const { container } = renderCard();
    const card = screen.getByRole('link', { name: /Abyssal Descent/ });
    expect(card).toHaveClass('bg-[#0c1220]');
    expect(card).toHaveClass('aspect-[8/9]');
    expect(screen.getByText('Begin your journey')).toHaveClass('text-[#d5b070]');
    expect(container.textContent).not.toContain('Open the box');
    expect(container.textContent).not.toContain('Ready-made heroes');
  });

  it('keeps the call to action a 44 px tall target', () => {
    renderCard();
    expect(screen.getByText('Begin your journey')).toHaveClass('min-h-11');
  });

  it('shows the difficulty in the hard colour for hard and deadly campaigns', () => {
    renderCard({ difficulty: 'deadly' });
    expect(screen.getByText('Deadly')).toHaveStyle({ color: '#ef8a8a' });
  });

  it('renders no image when the campaign has no cover art', () => {
    const { container } = renderCard({ coverImageUrl: null });
    expect(container.querySelector('img')).toBeNull();
  });
});
