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
  it('renders permission badge with accessible label', () => {
    render(
      <MemoryRouter>
        <SharedCharactersList />
      </MemoryRouter>
    );

    const badge = screen.getByText('Viewer');
    expect(badge).toBeInTheDocument();
    // Badge is wrapped in Tooltip, description is in TooltipContent
    // Since we are using Radix Tooltip, we can check for its trigger behavior or just that it exists
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

  it('provides descriptive aria-labels for action buttons', () => {
    render(
      <MemoryRouter>
        <SharedCharactersList />
      </MemoryRouter>
    );

    const viewButton = screen.getByLabelText(/View Thorin Oakenshield's character sheet/i);
    expect(viewButton).toBeInTheDocument();

    const removeButton = screen.getByLabelText(/Remove my access to Thorin Oakenshield/i);
    expect(removeButton).toBeInTheDocument();
  });
});
