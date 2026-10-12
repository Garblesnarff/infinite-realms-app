import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';

import { SharedCharactersList } from '../SharedCharactersList';

// Mock trpc hooks with a row in the real characters.listShared shape
// (Character columns plus a nested permission row).
vi.mock('@/infrastructure/api/trpc-hooks', () => ({
  useTRPC: vi.fn(() => ({
    characters: {
      listShared: {
        useQuery: vi.fn(() => ({
          data: [
            {
              id: 'char-1',
              name: 'Thorin Oakenshield',
              race: 'Dwarf',
              class: 'Fighter',
              level: 10,
              imageUrl: null,
              avatarUrl: null,
              campaignId: null,
              createdAt: '2024-01-01T00:00:00.000Z',
              updatedAt: '2024-01-01T00:00:00.000Z',
              stats: null,
              permission: {
                id: 'perm-1',
                characterId: 'char-1',
                userId: 'viewer-1',
                permissionLevel: 'viewer',
                canControlToken: false,
                canEditSheet: false,
                grantedAt: '2024-01-01T00:00:00.000Z',
                grantedBy: 'owner-1',
              },
            },
          ],
          isLoading: false,
          error: null,
        })),
      },
    },
  })),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn(() => ({
    toast: vi.fn(),
  })),
}));

describe('SharedCharactersList', () => {
  it('renders the character name from a listShared row', () => {
    render(
      <MemoryRouter>
        <SharedCharactersList />
      </MemoryRouter>,
    );

    expect(screen.getByText('Thorin Oakenshield')).toBeInTheDocument();
    expect(screen.getByText('Viewer')).toBeInTheDocument();
  });
});
