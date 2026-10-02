import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { StarterCampaignCard } from '../StarterCampaignCard';

const campaign = {
  id: 'academy-of-arcane-gastronomy',
  slug: 'academy-of-arcane-gastronomy',
  title: 'Academy of Arcane Gastronomy',
  tagline: 'A culinary mystery',
  genre: ['fantasy'],
  tone: ['whimsical'],
  difficulty: 'medium',
  levelRange: '1-5',
  estimatedSessions: '4',
  premise: 'The kitchen is hiding a secret.',
  creativeBrief: null,
  overview: null,
  isComplete: true,
  isPublished: true,
  isFeatured: false,
  coverImageUrl: null,
  bannerImageUrl: null,
};

describe('StarterCampaignCard artwork fallback', () => {
  it('shows the gradient and first letter, labeled honestly, when there is no cover', () => {
    render(
      <MemoryRouter>
        <StarterCampaignCard campaign={campaign} />
      </MemoryRouter>,
    );

    // The old fallback was an <img src="/card-placeholder.svg"> plus an "Artwork coming soon"
    // chip. #2259 replaces it with a gradient and the campaign's first letter, so there is
    // no <img> to assert on; the accessible name is unchanged.
    expect(screen.queryByRole('img', { hidden: true, name: /cover art/ })).not.toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Academy of Arcane Gastronomy artwork coming soon',
    );
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('falls back to the gradient and letter when the cover image fails to load', () => {
    render(
      <MemoryRouter>
        <StarterCampaignCard campaign={{ ...campaign, coverImageUrl: 'https://x.test/a.jpg' }} />
      </MemoryRouter>,
    );

    const cover = screen.getByAltText('Academy of Arcane Gastronomy cover art');
    expect(cover).toHaveAttribute('width');
    expect(cover).toHaveAttribute('height');
    fireEvent.error(cover);

    expect(screen.queryByAltText('Academy of Arcane Gastronomy cover art')).not.toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Academy of Arcane Gastronomy artwork coming soon',
    );
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('loads the first card eagerly and the others lazily', () => {
    const withCover = { ...campaign, coverImageUrl: 'https://x.test/a.jpg' };
    const { rerender } = render(
      <MemoryRouter>
        <StarterCampaignCard campaign={withCover} isFirst />
      </MemoryRouter>,
    );
    expect(screen.getByAltText(/cover art/)).toHaveAttribute('loading', 'eager');
    expect(screen.getByAltText(/cover art/)).toHaveAttribute('fetchpriority', 'high');

    rerender(
      <MemoryRouter>
        <StarterCampaignCard campaign={withCover} />
      </MemoryRouter>,
    );
    expect(screen.getByAltText(/cover art/)).toHaveAttribute('loading', 'lazy');
  });

  it('is one link and prints the title once', () => {
    render(
      <MemoryRouter>
        <StarterCampaignCard campaign={campaign} />
      </MemoryRouter>,
    );

    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link')).toHaveAttribute('href', `/explore/${campaign.slug}`);
    expect(
      screen.getByRole('heading', { name: 'Academy of Arcane Gastronomy' }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Academy of Arcane Gastronomy')).toHaveLength(1);
    // The italic tagline line is gone, so a tagline never repeats the title.
    expect(screen.queryByText('A culinary mystery')).not.toBeInTheDocument();
    expect(screen.getByText(/See the heroes/)).toBeInTheDocument();
  });

  it('shows level 1 when the stored span is the glued 7-10-11 range', () => {
    render(
      <MemoryRouter>
        <StarterCampaignCard campaign={{ ...campaign, levelRange: '7-10-11' }} />
      </MemoryRouter>,
    );

    expect(screen.getByText('Level 1')).toBeInTheDocument();
    expect(screen.queryByText(/7-10-11/)).not.toBeInTheDocument();
  });
});
