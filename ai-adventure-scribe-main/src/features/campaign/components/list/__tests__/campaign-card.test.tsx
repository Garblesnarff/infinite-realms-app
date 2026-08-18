import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { MemoizedCampaignCard } from '../campaign-card';

import { CAMPAIGN_ARTWORK_PLACEHOLDER } from '@/components/campaigns/campaign-artwork';

const mockUseCampaignImageHotLoading = vi.fn();

vi.mock('@/hooks/use-image-hot-loading', () => ({
  useCampaignImageHotLoading: (...args: unknown[]) => mockUseCampaignImageHotLoading(...args),
}));

vi.mock('@/features/campaign/hooks/use-character-selection', () => ({
  useCharacterSelection: vi.fn(() => ({
    isLoading: false,
    isCreating: false,
    isStarterCampaign: false,
    templates: [],
    characters: [],
    loadError: null,
    retryLoad: vi.fn(),
    handleSelectTemplate: vi.fn(),
    startGameWithCharacter: vi.fn(),
    handleCreateCharacter: vi.fn(),
    getModifier: vi.fn(),
  })),
}));

const campaign = {
  id: 'camp-1',
  name: 'The Sunken Archive',
  description: 'A drowned library of forbidden lore.',
  genre: 'mystery',
  difficulty_level: 'medium',
  campaign_length: 'medium',
  tone: 'dark',
};

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <MemoizedCampaignCard campaign={campaign} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CampaignCard artwork fallback', () => {
  it('never falls back to the retired card-background.jpeg art when hot-loaded artwork is missing', () => {
    mockUseCampaignImageHotLoading.mockReturnValue({
      imageUrl: '',
      isLoading: false,
      hasImage: true,
    });

    const { container } = renderCard();

    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', CAMPAIGN_ARTWORK_PLACEHOLDER);
    expect(img?.getAttribute('src')).not.toContain('card-background.jpeg');
    expect(screen.getByRole('status')).toHaveTextContent('Artwork coming soon');
  });

  it('shows an honest "Artwork unavailable" state when the image fails to load', () => {
    mockUseCampaignImageHotLoading.mockReturnValue({
      imageUrl: 'https://cdn.example.com/campaigns/camp-1.png',
      isLoading: false,
      hasImage: true,
    });

    const { container } = renderCard();

    const img = container.querySelector('img') as HTMLImageElement;
    expect(img).toHaveAttribute('src', 'https://cdn.example.com/campaigns/camp-1.png');

    fireEvent.error(img);

    expect(img).toHaveAttribute('src', CAMPAIGN_ARTWORK_PLACEHOLDER);
    expect(screen.getByRole('status')).toHaveTextContent('Artwork unavailable');
  });

  it('renders the shared title overlay with the campaign name', () => {
    mockUseCampaignImageHotLoading.mockReturnValue({
      imageUrl: 'https://cdn.example.com/campaigns/camp-1.png',
      isLoading: false,
      hasImage: true,
    });

    renderCard();

    expect(screen.getByText('Campaign')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'The Sunken Archive' })).toBeInTheDocument();
  });
});
