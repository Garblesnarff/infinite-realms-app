import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import CharacterCardComponent from '../character-card';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn(), toasts: [], dismiss: vi.fn() }),
}));

vi.mock('@/hooks/use-image-hot-loading', () => ({
  useCharacterImageHotLoading: () => ({
    imageUrl: null,
    isLoading: false,
    hasImage: false,
    error: null,
  }),
}));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: { deleteCharacter: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('@/features/campaign/hooks/use-campaigns-list', () => ({
  useCampaignsList: () => ({ data: [], isLoading: false, isError: false }),
}));

/** Shape mirrors what userDataApi.listCharacters returns (Supabase rows). */
const scholarCopy = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'char-scholar-1',
  name: 'The Scholar',
  level: 3,
  created_at: '2026-10-01T12:00:00.000Z',
  character_stats: [
    {
      max_hit_points: 24,
      current_hit_points: 18,
      armor_class: 12,
    },
  ],
  ...overrides,
});

const renderCard = (character: Record<string, unknown>): void => {
  render(
    <MemoryRouter>
      <CharacterCardComponent character={character as never} />
    </MemoryRouter>,
  );
};

const LocationProbe = (): JSX.Element => {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
};

describe('CharacterCard #209 at-rest caption', () => {
  it('shows name, level, HP and created date-time without hovering', () => {
    renderCard(scholarCopy());

    const caption = screen.getByTestId('character-card-caption');
    expect(within(caption).getByText('The Scholar')).toBeInTheDocument();
    // #311: the label carries the creation time, not just the date, so two
    // copies made on the same day are distinguishable.
    const expectedDateTime = new Date('2026-10-01T12:00:00.000Z').toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
    expect(caption).toHaveTextContent('Level 3');
    expect(caption).toHaveTextContent('HP 18/24');
    expect(caption).toHaveTextContent(`Created ${expectedDateTime}`);
  });

  it('distinguishes duplicate premade copies by HP and created date', () => {
    renderCard(scholarCopy({ id: 'char-scholar-1' }));
    renderCard(
      scholarCopy({
        id: 'char-scholar-2',
        created_at: '2026-10-08T09:30:00.000Z',
        character_stats: [{ max_hit_points: 24, current_hit_points: 7, armor_class: 12 }],
      }),
    );

    const captions = screen.getAllByTestId('character-card-caption');
    expect(captions).toHaveLength(2);
    expect(captions[0].textContent).not.toBe(captions[1].textContent);
    expect(captions[0]).toHaveTextContent('HP 18/24');
    expect(captions[1]).toHaveTextContent('HP 7/24');
  });

  it('distinguishes copies that differ only by creation date', () => {
    renderCard(scholarCopy({ id: 'char-scholar-1', created_at: '2026-10-01T12:00:00.000Z' }));
    renderCard(scholarCopy({ id: 'char-scholar-2', created_at: '2026-10-08T09:30:00.000Z' }));

    const captions = screen.getAllByTestId('character-card-caption');
    expect(captions).toHaveLength(2);
    // Same name, level and HP — the created date is the only distinguisher.
    expect(captions[0]).toHaveTextContent('HP 18/24');
    expect(captions[1]).toHaveTextContent('HP 18/24');
    expect(captions[0].textContent).not.toBe(captions[1].textContent);
  });

  it('distinguishes copies created on the same day by creation time', () => {
    // #311 retest: two "The Faithful" cards both read
    // "Level 1 - HP 10/10 - Created Oct 10, 2026" with the date-only label.
    renderCard(scholarCopy({ id: 'char-scholar-1', created_at: '2026-10-10T14:00:00.000Z' }));
    renderCard(scholarCopy({ id: 'char-scholar-2', created_at: '2026-10-10T18:30:00.000Z' }));

    const captions = screen.getAllByTestId('character-card-caption');
    expect(captions).toHaveLength(2);
    // Same name, level and HP — the creation time is the only distinguisher.
    expect(captions[0]).toHaveTextContent('HP 18/24');
    expect(captions[1]).toHaveTextContent('HP 18/24');
    expect(captions[0].textContent).not.toBe(captions[1].textContent);
  });

  it('gives each duplicate copy a distinct Delete accessible name', () => {
    // #311 retest: both Delete buttons were named "Delete The Faithful".
    renderCard(
      scholarCopy({ id: 'char-scholar-1', name: 'The Faithful', created_at: '2026-10-10T14:00:00.000Z' }),
    );
    renderCard(
      scholarCopy({ id: 'char-scholar-2', name: 'The Faithful', created_at: '2026-10-10T18:30:00.000Z' }),
    );

    const deleteButtons = screen.getAllByTestId('character-card-delete');
    expect(deleteButtons).toHaveLength(2);
    const names = deleteButtons.map((button) => button.getAttribute('aria-label'));
    expect(names[0]).toContain('Delete The Faithful');
    expect(names[1]).toContain('Delete The Faithful');
    expect(names[0]).not.toBe(names[1]);
  });

  it('omits caption segments when the data is missing', () => {
    renderCard({ id: 'char-bare', name: 'Nameless' });

    const caption = screen.getByTestId('character-card-caption');
    expect(within(caption).getByText('Nameless')).toBeInTheDocument();
    expect(caption.textContent).not.toContain('Level');
    expect(caption.textContent).not.toContain('HP');
    expect(caption.textContent).not.toContain('Created');
  });
});

describe('CharacterCard #209 always-visible Delete', () => {
  it('shows a Delete button without hovering and opens the confirm dialog on click', async () => {
    renderCard(scholarCopy());

    const deleteButton = screen.getByTestId('character-card-delete');
    expect(deleteButton).toBeVisible();
    // #311: the accessible name carries the creation time so duplicate
    // premade copies are distinguishable.
    const expectedDateTime = new Date('2026-10-01T12:00:00.000Z').toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
    expect(deleteButton).toHaveAccessibleName(`Delete The Scholar (created ${expectedDateTime})`);

    fireEvent.click(deleteButton);

    // The existing confirm dialog opens (works on touch: no hover needed).
    expect(await screen.findByText('Delete Character')).toBeInTheDocument();
    expect(screen.getByText('Permanently Delete')).toBeInTheDocument();
  });

  it('opens the confirm dialog on keyboard Enter without navigating to details', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/roster']}>
        <Routes>
          <Route
            path="/roster"
            element={
              <>
                <LocationProbe />
                <CharacterCardComponent character={scholarCopy() as never} />
              </>
            }
          />
          <Route path="/app/character/:id" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    // The hero div treats Enter/Space as "open details"; the Delete button must
    // not let that handler hijack keyboard activation.
    const deleteButton = screen.getByTestId('character-card-delete');
    deleteButton.focus();
    await user.keyboard('{Enter}');

    expect(await screen.findByText('Delete Character')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/roster');
  });

  it('hides Delete on fallen characters and keeps the Fallen badge', () => {
    renderCard(
      scholarCopy({
        character_stats: [{ max_hit_points: 24, current_hit_points: 0, vital_state: 'dead' }],
      }),
    );

    expect(screen.queryByTestId('character-card-delete')).not.toBeInTheDocument();
    expect(screen.getByTestId('character-fallen-badge')).toBeInTheDocument();
    // The caption still labels the copy.
    expect(screen.getByTestId('character-card-caption')).toHaveTextContent('The Scholar');
  });
});
