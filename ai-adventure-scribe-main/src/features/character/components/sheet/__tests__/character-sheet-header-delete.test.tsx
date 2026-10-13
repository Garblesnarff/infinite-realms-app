/**
 * Issue #311: character sheets had no Delete affordance, so a Play-created
 * copy that never appears on a list could not be removed. The sheet header —
 * the one place a character is always reachable at its own URL — now carries
 * an always-visible Delete with the confirm dialog, mirroring the roster card.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { CharacterSheetHeader } from '../CharacterSheetHeader';

const mockDeleteCharacter = vi.fn();
const mockToast = vi.fn();

vi.mock('@/services/user-data-api', () => ({
  userDataApi: { deleteCharacter: (...args: unknown[]) => mockDeleteCharacter(...args) },
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast, toasts: [], dismiss: vi.fn() }),
}));

const sheetCharacter = (): Record<string, unknown> => ({
  id: 'char-scholar-copy-1',
  name: 'The Scholar',
  level: 1,
  race: { name: 'Human' },
  class: { name: 'Wizard' },
  character_stats: [{ max_hit_points: 8, current_hit_points: 8, armor_class: 12 }],
});

const LocationProbe = (): JSX.Element => {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
};

const renderHeader = (): void => {
  render(
    <MemoryRouter initialEntries={['/app/character/char-scholar-copy-1']}>
      <Routes>
        <Route
          path="/app/character/:id"
          element={
            <>
              <LocationProbe />
              <CharacterSheetHeader character={sheetCharacter() as never} />
            </>
          }
        />
        <Route path="/app/characters" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
};

describe('CharacterSheetHeader #311 sheet Delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteCharacter.mockResolvedValue(undefined);
  });

  it('shows an always-visible Delete button without hovering', () => {
    renderHeader();

    const deleteButton = screen.getByTestId('character-sheet-delete');
    expect(deleteButton).toBeVisible();
    expect(deleteButton).toHaveAccessibleName('Delete The Scholar');
  });

  it('opens the confirm dialog and deletes, then returns to the roster', async () => {
    renderHeader();

    fireEvent.click(screen.getByTestId('character-sheet-delete'));

    expect(await screen.findByText('Delete Character')).toBeInTheDocument();
    expect(screen.getByText('Permanently Delete')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Permanently Delete'));

    expect(await screen.findByTestId('location')).toHaveTextContent('/app/characters');
    expect(mockDeleteCharacter).toHaveBeenCalledTimes(1);
    expect(mockDeleteCharacter).toHaveBeenCalledWith('char-scholar-copy-1');
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Character Deleted' }),
    );
  });

  it('stays on the sheet when the confirm dialog is cancelled', async () => {
    renderHeader();

    fireEvent.click(screen.getByTestId('character-sheet-delete'));
    expect(await screen.findByText('Delete Character')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Cancel'));

    expect(mockDeleteCharacter).not.toHaveBeenCalled();
    expect(screen.getByTestId('location')).toHaveTextContent('/app/character/char-scholar-copy-1');
  });
});
