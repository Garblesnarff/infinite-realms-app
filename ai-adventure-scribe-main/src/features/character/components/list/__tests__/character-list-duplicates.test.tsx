import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import CharacterList from '../character-list';

const data = vi.hoisted(() => {
  const characters = ['2', '1'].map((id) => ({
    id,
    name: 'The Scholar',
    level: 1,
    created_at: '2026-10-21T01:00:00.000Z',
  }));
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
  useCampaignsList: () => ({ data: [], isLoading: false, isError: false }),
}));
describe('#311 same-time roster copies', () => {
  it('shows distinct copy labels and Delete targets, stable through filtering', () => {
    const { rerender } = render(
      <MemoryRouter>
        <CharacterList />
      </MemoryRouter>,
    );
    expect(screen.getByText('Copy 1')).toBeInTheDocument();
    expect(screen.getByText('Copy 2')).toBeInTheDocument();
    const buttons = screen.getAllByTestId('character-card-delete');
    expect(buttons[0].getAttribute('aria-label')).not.toBe(buttons[1].getAttribute('aria-label'));
    fireEvent.click(buttons[0]);
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Copy 2');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    data.filteredCharacters = [data.characters[0]];
    rerender(
      <MemoryRouter>
        <CharacterList />
      </MemoryRouter>,
    );
    expect(screen.getByText('Copy 2')).toBeInTheDocument();
    expect(screen.queryByText('Copy 1')).not.toBeInTheDocument();
    data.filteredCharacters = data.characters;
  });
});
