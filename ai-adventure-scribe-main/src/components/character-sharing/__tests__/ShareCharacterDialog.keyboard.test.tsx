import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';

import { ShareCharacterDialog } from '../ShareCharacterDialog';

// Mock trpc hooks
vi.mock('@/infrastructure/api/trpc-hooks', () => ({
  useTRPC: vi.fn(() => ({
    characters: {
      listPermissions: {
        useQuery: vi.fn(() => ({
          data: [],
          isLoading: false,
          refetch: vi.fn(),
        })),
      },
      share: {
        useMutation: vi.fn(() => ({
          mutate: vi.fn(),
          isPending: false,
        })),
      },
      updatePermission: {
        useMutation: vi.fn(() => ({
          mutate: vi.fn(),
          isPending: false,
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
}));

// Mock toast
vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn(() => ({
    toast: vi.fn(),
  })),
}));

describe('ShareCharacterDialog Keyboard Navigation', () => {
  it('navigates through suggestions with arrow keys and selects with Enter', () => {
    render(
      <ShareCharacterDialog
        open={true}
        onOpenChange={() => {}}
        characterId="char-123"
      />
    );

    const input = screen.getByPlaceholderText(/Search by name or email/i);

    // Type to show suggestions (using mock users: John Smith, Jane Doe, Bob Wilson)
    fireEvent.change(input, { target: { value: 'j' } });

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2); // John Smith, Jane Doe

    // Initial selection should be first item
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', options[0].id);

    // Press Down to move to Jane Doe
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(options[0]).toHaveAttribute('aria-selected', 'false');
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', options[1].id);

    // Press Enter to select Jane Doe
    fireEvent.keyDown(input, { key: 'Enter' });

    // Input should now contain 'Jane Doe'
    expect(input).toHaveValue('Jane Doe');

    // Suggestions should be hidden
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('closes suggestions and clears input on Escape even if no results', () => {
    render(
      <ShareCharacterDialog
        open={true}
        onOpenChange={() => {}}
        characterId="char-123"
      />
    );

    const input = screen.getByPlaceholderText(/Search by name or email/i);

    // No results for this query
    fireEvent.change(input, { target: { value: 'xyz' } });
    expect(screen.queryByRole('option')).not.toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(input).toHaveValue('');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('closes suggestions on blur after a delay', async () => {
    vi.useFakeTimers();
    render(
      <ShareCharacterDialog
        open={true}
        onOpenChange={() => {}}
        characterId="char-123"
      />
    );

    const input = screen.getByPlaceholderText(/Search by name or email/i);
    fireEvent.change(input, { target: { value: 'j' } });
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.blur(input);

    // Still there immediately
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    // Advance timers
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    vi.useRealTimers();
  });
});
