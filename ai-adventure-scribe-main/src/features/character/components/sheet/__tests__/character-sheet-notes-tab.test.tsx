/**
 * #2701: saving on the Notes tab must persist the edit and keep the Notes tab
 * active. Before the fix, onUpdate was wired straight to refetch, which set
 * loading=true, showed the skeleton, unmounted the tabs and reset the active
 * tab to Main — and the edit was never written.
 *
 * Renders the real CharacterSheet (real useCharacterData hook, real
 * transformer, every tab) with the API layer mocked, so this proves the actual
 * wiring: blur-save -> PUT -> silent refresh, tabs stay mounted.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockToast, mockGetCharacter, mockUpdateCharacter, mockGetEquipment, authState } =
  vi.hoisted(() => ({
    mockToast: vi.fn(),
    mockGetCharacter: vi.fn(),
    mockUpdateCharacter: vi.fn(),
    mockGetEquipment: vi.fn(),
    // Stable identity: a fresh user object per render re-runs fetchCharacter (#2149).
    authState: { user: { id: 'user-1' } },
  }));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: new Proxy(
    { getCharacter: mockGetCharacter, updateCharacter: mockUpdateCharacter },
    {
      get: (target: Record<string, unknown>, prop: string) =>
        prop in target ? target[prop] : vi.fn().mockResolvedValue([]),
    },
  ),
}));

vi.mock('@/services/issue-1784-api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    Issue1784ApiError: actual.Issue1784ApiError,
    issue1784Api: new Proxy(
      { getCharacterEquipment: mockGetEquipment },
      {
        get: (target: Record<string, unknown>, prop: string) =>
          prop in target ? target[prop] : vi.fn().mockResolvedValue([]),
      },
    ),
  };
});

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => authState,
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
  toast: mockToast,
}));

import CharacterSheet from '../character-sheet';

import { TooltipProvider } from '@/components/ui/tooltip';

const CHARACTER_ID = '123e4567-e89b-42d3-a456-426614174000';

// Mirrors mapCharacterToApi (server-bun/src/routes/v1/characters.ts) after
// normalizeCharacter: character_stats arrives as a one-item array.
const characterRow = {
  id: CHARACTER_ID,
  user_id: 'user-1',
  name: 'Test Hero',
  description: null,
  race: 'Human',
  subrace: null,
  class: 'Fighter',
  level: 1,
  background: null,
  alignment: '',
  experience_points: 0,
  appearance: null,
  personality_traits: null,
  personality_notes: null,
  backstory_elements: null,
  session_notes: null,
  character_stats: null,
};

const renderSheet = (): ReturnType<typeof render> => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[`/app/character/${CHARACTER_ID}`]}>
          <Routes>
            <Route path="/app/character/:id" element={<CharacterSheet />} />
            <Route path="/app/characters" element={<div>characters list</div>} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
};

const openNotesTab = async (): Promise<void> => {
  const user = userEvent.setup();
  await screen.findByRole('tab', { name: /main/i }, { timeout: 10000 });
  await user.click(screen.getByRole('tab', { name: /notes & backstory/i }));
  await user.click(screen.getByRole('tab', { name: /^notes$/i }));
};

describe('CharacterSheet Notes tab (#2701)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCharacter.mockResolvedValue(characterRow);
    mockUpdateCharacter.mockResolvedValue({});
    mockGetEquipment.mockResolvedValue([]);
  });

  it('saving session notes persists them and keeps the Notes tab active', async () => {
    // The post-save silent refresh reads back what the server stored, like the
    // real route does after the PUT lands.
    mockGetCharacter
      .mockResolvedValueOnce(characterRow)
      .mockResolvedValue({ ...characterRow, session_notes: 'Met the innkeeper.' });
    renderSheet();
    await openNotesTab();

    const textarea = screen.getByPlaceholderText(/keep track of important events/i);
    fireEvent.change(textarea, { target: { value: 'Met the innkeeper.' } });
    // Blur flushes the debounced save immediately.
    fireEvent.blur(textarea);

    // The edit is written through the character update API...
    await waitFor(() => {
      expect(mockUpdateCharacter).toHaveBeenCalledWith(CHARACTER_ID, {
        session_notes: 'Met the innkeeper.',
      });
    });

    // ...and the sheet refreshes without the skeleton: the tabs stay mounted
    // and the Notes tab is still the active one.
    await waitFor(() => {
      expect(mockGetCharacter).toHaveBeenCalledTimes(2);
    });
    // Blur is the explicit save gesture, so it confirms with a toast.
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Notes saved' }));
    });
    expect(
      screen.getByRole('tab', { name: /notes & backstory/i }).getAttribute('data-state'),
    ).toBe('active');
    const notesAgain = screen.getByPlaceholderText(/keep track of important events/i);
    expect(notesAgain).toBeInTheDocument();
    expect(notesAgain).toHaveValue('Met the innkeeper.');
  });

  it('hydrates session notes already stored on the server row', async () => {
    // Without session_notes hydration, a fresh mount showed an empty box even
    // when the database had notes — and the silent post-save refresh would
    // have replaced freshly saved notes with undefined.
    mockGetCharacter.mockResolvedValue({ ...characterRow, session_notes: 'Earlier notes.' });
    renderSheet();
    await openNotesTab();
    expect(screen.getByPlaceholderText(/keep track of important events/i)).toHaveValue(
      'Earlier notes.',
    );
  });

  it('shows an error toast when the save fails and keeps the tab', async () => {
    mockUpdateCharacter.mockRejectedValueOnce(new Error('boom'));
    renderSheet();
    await openNotesTab();

    const textarea = screen.getByPlaceholderText(/keep track of important events/i);
    fireEvent.change(textarea, { target: { value: 'Met the innkeeper.' } });
    fireEvent.blur(textarea);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Save failed', variant: 'destructive' }),
      );
    });
    expect(
      screen.getByRole('tab', { name: /notes & backstory/i }).getAttribute('data-state'),
    ).toBe('active');
  });
});
