import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { MemoizedCampaignCard } from '../campaign-card';

// #1610: the in-app Campaigns screen keeps its own card. The public Explore
// navy card must not leak into it.
vi.mock('@/hooks/use-image-hot-loading', () => ({
  useCampaignImageHotLoading: () => ({ imageUrl: '', isLoading: false, hasImage: false }),
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

describe('in-app Campaigns card is unchanged by the public Explore card (#1610)', () => {
  it('still renders the in-app campaign card, not the public Explore navy card', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <MemoizedCampaignCard campaign={campaign} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(container.querySelector('.campaign-card')).not.toBeNull();
    expect(container.textContent).not.toContain('Begin your journey');
    expect(container.querySelector('.bg-\\[\\#0c1220\\]')).toBeNull();
  });
});
