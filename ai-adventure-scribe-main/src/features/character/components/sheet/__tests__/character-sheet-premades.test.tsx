/**
 * Issue #2150: The Exile and The Reveler sheets showed "Failed to load character data".
 *
 * Renders the real CharacterSheet (real useCharacterData hook, real transformer, every tab)
 * against API payloads shaped like the starter premades, plus a character whose race,
 * background and class the client tables do not know.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockToast, mockGetCharacter, mockGetEquipment, authState } = vi.hoisted(() => ({
  mockToast: vi.fn(),
  mockGetCharacter: vi.fn(),
  mockGetEquipment: vi.fn(),
  // Stable identity: a fresh user object per render re-runs fetchCharacter (#2149).
  authState: { user: { id: 'user-1' } },
}));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: new Proxy(
    { getCharacter: mockGetCharacter },
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

vi.mock('@/services/gallery-service', () => ({
  listEntityImages: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/services/characterSpellApi', () => ({
  characterSpellService: new Proxy({}, { get: () => vi.fn().mockResolvedValue([]) }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => authState,
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
  toast: mockToast,
}));

import CharacterSheet from '../character-sheet';

import { TooltipProvider } from '@/components/ui/tooltip';
import { Issue1784ApiError } from '@/services/issue-1784-api';

type Premade = {
  name: string;
  race: string;
  subrace?: string | null;
  class: string;
  background: string | null;
};

// Race / class / background of each starter premade, from
// supabase/migrations/20260103_seed_starter_character_templates.sql (+ the 20260117 update)
// and the prod rows Hetzner read on #2150 (The Exile's copy is a Drow Druid).
const PREMADES: Premade[] = [
  { name: 'The Veteran', race: 'Human', class: 'Fighter', background: 'Soldier' },
  { name: 'The Scholar', race: 'Human', class: 'Wizard', background: 'Sage' },
  { name: 'The Hunter', race: 'Human', class: 'Ranger', background: 'Outlander' },
  { name: 'The Pact-Bound', race: 'Tiefling', class: 'Warlock', background: 'Haunted One' },
  { name: 'The Exile', race: 'Elf', subrace: 'Drow', class: 'Druid', background: 'Outlander' },
  { name: 'The Storyteller', race: 'Half-Elf', class: 'Bard', background: 'Entertainer' },
  { name: 'The Faithful', race: 'Human', class: 'Cleric', background: 'Acolyte' },
  { name: 'The Lucky One', race: 'Halfling', class: 'Rogue', background: 'Charlatan' },
  { name: 'The Reveler', race: 'Satyr', class: 'Barbarian', background: 'Entertainer' },
  { name: 'The Seeker', race: 'Catfolk', class: 'Ranger', background: 'Anthropologist' },
  { name: 'The Apprentice', race: 'Human', class: 'Wizard', background: 'Sage' },
];

const CHARACTER_ID = '0d023725-d9dc-4389-9775-28b7342938e7';

// Mirrors mapCharacterToApi (server-bun/src/routes/v1/characters.ts) after normalizeCharacter.
const apiPayload = (premade: Premade): Record<string, unknown> => ({
  id: CHARACTER_ID,
  user_id: 'user-1',
  name: premade.name,
  description: null,
  race: premade.race,
  subrace: premade.subrace ?? null,
  class: premade.class,
  level: 1,
  background: premade.background,
  alignment: 'Chaotic Good',
  experience_points: 0,
  skill_proficiencies: 'athletics, perception',
  expertise_proficiencies: null,
  tool_proficiencies: null,
  saving_throw_proficiencies: null,
  languages: ['Common'],
  cantrips: null,
  known_spells: null,
  prepared_spells: null,
  ritual_spells: null,
  spell_slots: null,
  class_features: null,
  vision_types: null,
  character_stats: [
    {
      strength: 14,
      dexterity: 14,
      constitution: 14,
      intelligence: 10,
      wisdom: 12,
      charisma: 16,
      armor_class: 13,
      max_hit_points: 12,
      current_hit_points: 12,
    },
  ],
});

const TAB_LABELS = [
  'Main',
  'Abilities & Skills',
  'Advancement',
  'Spells',
  'Equipment',
  'Features & Traits',
  'Notes',
  'Gallery',
];

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

const renderEveryTab = async (name: string): Promise<void> => {
  const user = userEvent.setup();
  await screen.findByRole('tab', { name: /Main/i }, { timeout: 10000 });
  expect(screen.getAllByText(name).length).toBeGreaterThan(0);
  for (const label of TAB_LABELS) {
    const trigger = screen.getByRole('tab', { name: new RegExp(label, 'i') });
    await user.click(trigger);
    expect(trigger.getAttribute('data-state')).toBe('active');
    expect(screen.getAllByText(name).length).toBeGreaterThan(0);
  }
};

describe('CharacterSheet renders every starter premade (#2150)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEquipment.mockResolvedValue([]);
  });

  it.each(PREMADES)('$name ($race $class, $background)', async (premade) => {
    mockGetCharacter.mockResolvedValue(apiPayload(premade));

    renderSheet();
    await renderEveryTab(premade.name);

    expect(mockToast).not.toHaveBeenCalled();
    expect(screen.queryByText('characters list')).toBeNull();
    // Every premade's race, class and background is in the client tables.
    expect(screen.queryByTestId('character-unresolved-data')).toBeNull();
    expect(screen.queryByTestId('character-equipment-unavailable')).toBeNull();
  });

  it('renders every tab with an equipment warning when the equipment request fails', async () => {
    // Prod: GET /equipment answered 200 with "[object Object]…"; request() now rejects that.
    mockGetEquipment.mockRejectedValue(
      new Issue1784ApiError(
        'Unparseable response body from /v1/characters/x/equipment',
        200,
        'BODY_UNPARSEABLE',
      ),
    );
    mockGetCharacter.mockResolvedValue(apiPayload(PREMADES[8])); // The Reveler

    renderSheet();
    await renderEveryTab('The Reveler');

    expect(mockToast).not.toHaveBeenCalled();
    expect(screen.queryByText('characters list')).toBeNull();
    expect(screen.getByTestId('character-equipment-unavailable').textContent).toContain(
      'Equipment unavailable',
    );
  });

  it('renders a character whose race and background the client does not know', async () => {
    mockGetCharacter.mockResolvedValue(
      apiPayload({
        name: 'The Stranger',
        race: 'Starborn Owlkin',
        subrace: 'Moonfeather',
        class: 'Barbarian',
        background: 'Lighthouse Keeper',
      }),
    );

    renderSheet();
    await renderEveryTab('The Stranger');

    expect(mockToast).not.toHaveBeenCalled();
    expect(screen.queryByText('characters list')).toBeNull();
    expect(screen.getByTestId('character-unresolved-data').textContent).toContain(
      'Unknown race: Starborn Owlkin. Unknown background: Lighthouse Keeper.',
    );
  });
});
