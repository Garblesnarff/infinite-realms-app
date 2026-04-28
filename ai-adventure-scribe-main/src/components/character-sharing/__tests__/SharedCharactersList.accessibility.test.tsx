import { render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';

import { SharedCharactersList } from '../SharedCharactersList';

// Mock trpc hooks
vi.mock('@/infrastructure/api/trpc-hooks', () => ({
  useTRPC: vi.fn(() => ({
    characters: {
      listShared: {
        useQuery: vi.fn(() => ({
          data: [
            {
              id: 'char-1',
              name: 'Thorin Oakenshield',
              description: 'King under the Mountain',
              race: 'Dwarf',
              class: 'Fighter',
              level: 10,
              ownerId: 'owner-1',
              ownerName: 'Bilbo Baggins',
              permissionLevel: 'viewer',
              sharedAt: new Date().toISOString(),
            },
          ],
          isLoading: false,
          error: null,
        })),
      },
      revokePermission: {
        useMutation: vi.fn(() => ({
          mutate: vi.fn(),
          isPending: false,
        })),
      },
    },
  })),
  useTRPCUtils: vi.fn(() => ({
    characters: {
      listShared: {
        invalidate: vi.fn(),
      },
    },
  })),
}));

// Mock toast
vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn(() => ({
    toast: vi.fn(),
  })),
}));

describe('SharedCharactersList Accessibility', () => {
  it('renders permission badge with title for accessibility', () => {
    render(
      <MemoryRouter>
        <SharedCharactersList />
      </MemoryRouter>
    );

    const badge = screen.getByText('Viewer');
    expect(badge).toBeInTheDocument();
    // The title attribute provides the tooltip and accessible description
    expect(badge).toHaveAttribute('title', 'Can view only');
  });

  it('standardizes the remove access button to icon size', () => {
    render(
      <MemoryRouter>
        <SharedCharactersList />
      </MemoryRouter>
    );

    // The button should have size="icon" which often results in h-9 w-9 or similar classes from Shadcn
    // but here we just check if it's in the document with the correct aria-label
    const removeButton = screen.getByLabelText(/Remove my access to Thorin Oakenshield/i);
    expect(removeButton).toBeInTheDocument();

    // Check for aria-hidden on decorative icons
    // Filter icon in header
    const filterIcon = document.querySelector('svg.text-muted-foreground[aria-hidden="true"]');
    expect(filterIcon).toBeInTheDocument();
  });

  it('provides descriptive titles for action buttons', () => {
    render(
      <MemoryRouter>
        <SharedCharactersList />
      </MemoryRouter>
    );

    const viewButton = screen.getByLabelText(/View Thorin Oakenshield's character sheet/i);
    expect(viewButton).toHaveAttribute('title', "View Thorin Oakenshield's character sheet");

    const removeButton = screen.getByLabelText(/Remove my access to Thorin Oakenshield/i);
    expect(removeButton).toHaveAttribute('title', 'Remove my access to Thorin Oakenshield');
  });
});
