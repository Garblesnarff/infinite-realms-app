/**
 * #204 / QA-033: traits loaded from the personality_notes envelope must show
 * on the sheet as a list with a Remove control — not just an Add box.
 *
 * Renders the real CharacterSheet (real useCharacterData hook, real
 * transformCharacterData loader, real PersonalityManager) with the API layer
 * mocked, so this proves the actual chain: stored envelope -> loader hydrates
 * the arrays -> the Personality tab lists them with Remove buttons.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
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

// The envelope the server stores in personality_notes (see
// src/utils/character/personality-envelope.ts).
const envelope = JSON.stringify({
  traits: ['Brave in battle', 'Loyal to a fault'],
  ideals: ['Protect the innocent'],
  bonds: ['My sister Mara'],
  flaws: ['Quick to anger'],
  inspiration: false,
  lastInspiration: null,
  inspirationHistory: [],
});

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
  personality_notes: envelope,
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

describe('CharacterSheet personality list (#204, QA-033)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCharacter.mockResolvedValue(characterRow);
    mockUpdateCharacter.mockResolvedValue({});
    mockGetEquipment.mockResolvedValue([]);
  });

  it('lists the stored traits with a Remove control', async () => {
    const user = userEvent.setup();
    renderSheet();

    await screen.findByRole('tab', { name: /main/i }, { timeout: 10000 });
    await user.click(screen.getByRole('tab', { name: /notes & backstory/i }));
    await user.click(screen.getByRole('tab', { name: /^personality$/i }));

    // The envelope's traits hydrate into a visible list...
    expect(await screen.findByText('Brave in battle')).toBeInTheDocument();
    expect(screen.getByText('Loyal to a fault')).toBeInTheDocument();
    // ...each with a Remove control (QA-033: the Add box alone is not enough).
    const removeButtons = screen.getAllByRole('button', { name: /remove trait/i });
    expect(removeButtons.length).toBeGreaterThanOrEqual(2);
  });
});
