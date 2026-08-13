import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { CampaignDetailHero } from '../CampaignDetailHero';

const campaign = {
  id: 'academy-of-arcane-gastronomy',
  slug: 'academy-of-arcane-gastronomy',
  title: 'Academy of Arcane Gastronomy',
  tagline: null,
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

describe('CampaignDetailHero artwork fallback', () => {
  it('shows the honest placeholder state and reports image failures', () => {
    const onBannerImageError = vi.fn();

    render(
      <MemoryRouter>
        <CampaignDetailHero
          campaign={campaign}
          bannerImage="/card-placeholder.svg"
          artworkUnavailable
          onBannerImageError={onBannerImageError}
          onStartAdventure={vi.fn(async () => {})}
          isStarting={false}
        />
      </MemoryRouter>,
    );

    const image = screen.getByRole('img');
    expect(image).toHaveAttribute('src', '/card-placeholder.svg');
    expect(screen.getByRole('status')).toHaveTextContent('Artwork coming soon');

    fireEvent.error(image);
    expect(onBannerImageError).toHaveBeenCalledOnce();
  });
});
