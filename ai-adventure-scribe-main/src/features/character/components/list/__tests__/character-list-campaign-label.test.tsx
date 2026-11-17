import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import CharacterList from '../character-list';

const data = vi.hoisted(() => {
  const characters = [
    {
      id: 'in-campaign',
      name: 'The Scholar',
      level: 1,
      created_at: '2026-10-21T01:00:00.000Z',
      campaign_id: 'camp-abyssal',
    },
    {
      id: 'loose',
      name: 'Mira',
      level: 1,
      created_at: '2026-10-20T01:00:00.000Z',
      campaign_id: null,
    },
  ];
  return {
    characters,
    filteredCharacters: characters,
    loading: false,
    fetchCharacters: vi.fn(),
    setSearchTerm: vi.fn(),
  };
});
vi.mock('@/features/character/hooks/use-character-list-data', () => ({
  useCharacterListData: () => data,
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'owner' } }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/use-image-hot-loading', () => ({
  useCharacterImageHotLoading: () => ({
    imageUrl: null,
    isLoading: false,
    hasImage: false,
    error: null,
  }),
}));
vi.mock('@/services/user-data-api', () => ({ userDataApi: { deleteCharacter: vi.fn() } }));
vi.mock('@/features/campaign/hooks/use-campaigns-list', () => ({
  useCampaignsList: () => ({
    data: [{ id: 'camp-abyssal', name: 'Abyssal Descent', status: 'active' }],
    isLoading: false,
    isError: false,
  }),
}));

describe('#209 roster campaign label', () => {
  it('names the campaign on the card of a character that belongs to one, and only that card', () => {
    render(
      <MemoryRouter>
        <CharacterList />
      </MemoryRouter>,
    );

    const captions = screen.getAllByTestId('character-card-caption');
    expect(captions).toHaveLength(2);
    expect(within(captions[0]).getByTestId('character-card-campaign')).toHaveTextContent(
      'Campaign: Abyssal Descent',
    );
    expect(within(captions[1]).queryByTestId('character-card-campaign')).not.toBeInTheDocument();
  });
});
