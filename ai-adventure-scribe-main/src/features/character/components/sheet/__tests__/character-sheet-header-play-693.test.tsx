/**
 * Issue #693: the character sheet (/app/character/:id) had no "Play as this
 * character" affordance — a just-created character could only be played from
 * the roster card hover, forcing a trip back to the list. The sheet header
 * now carries the same Play button (same campaign picker as the roster).
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { CharacterSheetHeader } from '../CharacterSheetHeader';

const mockDeleteCharacter = vi.fn();
const mockToast = vi.fn();

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'char-owner-1' } }),
}));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: { deleteCharacter: (...args: unknown[]) => mockDeleteCharacter(...args) },
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast, toasts: [], dismiss: vi.fn() }),
}));

// The campaign picker is covered by its own suite; here it just needs to
// render without fetching.
vi.mock('../../list/campaign-selection-modal', () => ({
  default: ({
    isOpen,
    characterId,
  }: {
    isOpen: boolean;
    characterId: string;
  }) =>
    isOpen ? (
      <div data-testid="campaign-selection-modal" data-character-id={characterId} />
    ) : null,
}));

const sheetCharacter = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'char-new-1',
  user_id: 'char-owner-1',
  name: 'New Hero',
  level: 1,
  race: { name: 'Human' },
  class: { name: 'Fighter' },
  character_stats: [{ max_hit_points: 12, current_hit_points: 12, armor_class: 14 }],
  ...overrides,
});

const renderHeader = (character: Record<string, unknown>): void => {
  render(
    <MemoryRouter initialEntries={['/app/character/char-new-1']}>
      <Routes>
        <Route
          path="/app/character/:id"
          element={<CharacterSheetHeader character={character as never} />}
        />
      </Routes>
    </MemoryRouter>,
  );
};

describe('CharacterSheetHeader #693 sheet Play', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteCharacter.mockResolvedValue(undefined);
  });

  it('shows "Play as this character" for an owned character', () => {
    renderHeader(sheetCharacter());

    const playButton = screen.getByRole('button', { name: 'Play as this character' });
    expect(playButton).toBeVisible();
  });

  it('opens the campaign picker with the character id when Play is clicked', () => {
    renderHeader(sheetCharacter());

    fireEvent.click(screen.getByRole('button', { name: 'Play as this character' }));

    const modal = screen.getByTestId('campaign-selection-modal');
    expect(modal).toBeInTheDocument();
    expect(modal).toHaveAttribute('data-character-id', 'char-new-1');
  });

  it('hides Play for a non-owner (same rule as Export)', () => {
    renderHeader(sheetCharacter({ user_id: 'someone-else' }));

    expect(
      screen.queryByRole('button', { name: 'Play as this character' }),
    ).not.toBeInTheDocument();
  });
});
