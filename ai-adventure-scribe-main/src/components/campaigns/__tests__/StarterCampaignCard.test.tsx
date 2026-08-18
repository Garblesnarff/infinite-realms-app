import { render, screen } from '@testing-library/react';
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
  it('uses the local placeholder and labels missing artwork honestly', () => {
    render(
      <MemoryRouter>
        <StarterCampaignCard campaign={campaign} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('img')).toHaveAttribute('src', '/card-placeholder.svg');
    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Academy of Arcane Gastronomy artwork coming soon',
    );
    expect(screen.getByRole('status')).toHaveTextContent('Artwork coming soon');
  });

  it('renders the shared title overlay for the campaign title', () => {
    render(
      <MemoryRouter>
        <StarterCampaignCard campaign={campaign} />
      </MemoryRouter>,
    );

    expect(screen.getByText('Campaign')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Academy of Arcane Gastronomy' }),
    ).toBeInTheDocument();
  });
});
