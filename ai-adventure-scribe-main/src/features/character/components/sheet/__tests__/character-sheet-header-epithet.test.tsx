/**
 * #1741: a premade hero the player named shows the premade's title after the name on the
 * sheet: "Mara, the Seeker". A hero made without a premade shows its name alone.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { CharacterSheetHeader } from '../CharacterSheetHeader';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'char-owner-1' } }),
}));
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn(), toasts: [], dismiss: vi.fn() }),
}));
vi.mock('../../list/campaign-selection-modal', () => ({
  default: () => null,
}));

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

const hero = (overrides: Record<string, unknown>): Record<string, unknown> => ({
  id: 'char-new-1',
  user_id: 'char-owner-1',
  name: 'Mara',
  level: 3,
  race: { name: 'Human' },
  class: { name: 'Fighter' },
  character_stats: [{ max_hit_points: 28, current_hit_points: 28, armor_class: 16 }],
  ...overrides,
});

describe('CharacterSheetHeader premade title (#1741)', () => {
  it('shows the name with the premade title after it', () => {
    renderHeader(hero({ starter_title: 'The Seeker' }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Mara, the Seeker');
  });

  it('shows the name alone for a hero made without a premade', () => {
    renderHeader(hero({ starter_title: null }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Mara$/);
  });
});
