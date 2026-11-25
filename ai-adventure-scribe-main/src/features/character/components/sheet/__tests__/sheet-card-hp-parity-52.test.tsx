/**
 * #52: the sheet and the in-game card render the same HP number from one fixture.
 *
 * All three display surfaces read the stored `character_stats` row through
 * `getCharacterSheetHitPoints` — the sheet header (`CharacterSheetHeader`,
 * "7/7"), the sheet vitals (`MainTab` → `CombatVitals`, "7 / 7" via the
 * `useCombatState` hook seeded from stored HP), and the in-game card
 * (`CompactCharacterHeader`, "7/7"). This test renders all three from a single
 * fixture whose stored HP (7/7) disagrees with the preview formula
 * (`calculateHitPoints` says 6): if any surface ever goes back to deriving HP,
 * it renders 6 and this test fails.
 */
import { render, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CharacterSheetHeader } from '../CharacterSheetHeader';
import MainTab from '../tabs/MainTab';

import type { Character } from '@/types/character';

import { useCharacter } from '@/contexts/CharacterContext';
import { CompactCharacterHeader } from '@/features/game-session/components/game/CompactCharacterHeader';
import { calculateHitPoints } from '@/utils/character/basic-math';
import { transformCharacterData } from '@/utils/character/data-transformers';

const mockDeleteCharacter = vi.fn();
const mockGetCharacterCombatStatus = vi.fn();

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-owner' } }),
}));

vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: vi.fn(),
}));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    deleteCharacter: (...args: unknown[]) => mockDeleteCharacter(...args),
    getCharacterCombatStatus: (...args: unknown[]) => mockGetCharacterCombatStatus(...args),
  },
}));

vi.mock('@/services/rest-api', () => ({
  restApi: { shortRest: vi.fn(), longRest: vi.fn(), attuneItem: vi.fn() },
  applyRestResultToCharacter: (character: Character): Character => character,
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn(), toasts: [], dismiss: vi.fn() }),
}));

// The campaign picker is covered by its own suite; here it just needs to
// render without fetching.
vi.mock('../../list/campaign-selection-modal', () => ({
  default: ({ isOpen, characterId }: { isOpen: boolean; characterId: string }) =>
    isOpen ? <div data-testid="campaign-selection-modal" data-character-id={characterId} /> : null,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
    channel: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

/** The M2 Apprentice shape, built by the real producer: Wizard 1, CON 10, stored 7/7. */
const buildApprentice = (currentHitPoints: number, maxHitPoints: number): Character =>
  transformCharacterData(
    {
      id: 'char-apprentice',
      user_id: 'user-owner',
      name: 'The Apprentice',
      race: 'Human',
      class: 'Wizard',
      level: 1,
    },
    {
      strength: 10,
      dexterity: 10,
      constitution: 10,
      intelligence: 10,
      wisdom: 10,
      charisma: 10,
      current_hit_points: currentHitPoints,
      max_hit_points: maxHitPoints,
      armor_class: 11,
    },
    [],
  );

interface RenderedSurfaces {
  header: HTMLElement;
  vitals: HTMLElement;
  card: HTMLElement;
}

const renderAllThree = (character: Character): RenderedSurfaces => {
  (useCharacter as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    state: { character },
  });
  const header = render(
    <MemoryRouter initialEntries={['/app/character/char-apprentice']}>
      <Routes>
        <Route path="/app/character/:id" element={<CharacterSheetHeader character={character} />} />
      </Routes>
    </MemoryRouter>,
  ).container;
  const vitals = render(
    <MainTab character={character} onUpdate={vi.fn()} onCharacterUpdate={vi.fn()} />,
  ).container;
  const card = render(<CompactCharacterHeader />).container;
  return { header, vitals, card };
};

describe('sheet header, sheet vitals, and card HP parity (#52)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteCharacter.mockResolvedValue(undefined);
    // No active combat: the card falls back to the stored sheet HP.
    mockGetCharacterCombatStatus.mockResolvedValue(null);
  });

  it('renders the same stored HP on all three surfaces', async () => {
    const character = buildApprentice(7, 7);

    // The fixture discriminates: preview math says 6, the stored row says 7.
    expect(calculateHitPoints(character)).toBe(6);

    const { header, vitals, card } = renderAllThree(character);

    // Sheet header: the stored "7/7" line.
    expect(within(header).getByText('7/7')).toBeInTheDocument();
    // Sheet vitals: the CombatVitals badge renders "7 / 7" from useCombatState.
    expect(within(vitals).getByText('7 / 7')).toBeInTheDocument();
    // In-game card: the stored "7/7" line, with the matching accessible label.
    expect(within(card).getByText('7/7')).toBeInTheDocument();
    expect(await within(card).findByLabelText('Hit Points: 7 out of 7')).toBeInTheDocument();
  });

  it('keeps a stored zero current HP on all three surfaces', async () => {
    const character = buildApprentice(0, 10);

    expect(calculateHitPoints(character)).toBe(6);

    const { header, vitals, card } = renderAllThree(character);

    expect(within(header).getByText('0/10')).toBeInTheDocument();
    expect(within(vitals).getByText('0 / 10')).toBeInTheDocument();
    expect(within(card).getByText('0/10')).toBeInTheDocument();
    expect(await within(card).findByLabelText('Hit Points: 0 out of 10')).toBeInTheDocument();
  });
});
