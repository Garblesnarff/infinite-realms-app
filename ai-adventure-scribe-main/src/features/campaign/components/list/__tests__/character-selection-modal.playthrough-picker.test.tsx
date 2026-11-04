/**
 * #1380: when a template pick finds more than one saved playthrough for
 * the hero name, the hub modal shows the "Choose a saved playthrough"
 * picker; choosing one continues that character, closing without choosing
 * seeds nothing.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CharacterSelectionModal from '../character-selection-modal';

import type { SavedPlaythrough } from '@/pages/saved-playthroughs';

const mockChoosePlaythrough = vi.fn();
const mockClearPlaythroughChoices = vi.fn();
let mockPlaythroughChoices: SavedPlaythrough[] | null = null;

vi.mock('@/features/campaign/hooks/use-character-selection', () => ({
  useCharacterSelection: vi.fn(() => ({
    isLoading: false,
    isCreating: false,
    isStarterCampaign: true,
    templates: [],
    characters: [],
    accountCharacters: [],
    rosterError: null,
    loadError: null,
    retryLoad: vi.fn(),
    starterCampaignId: 'starter-1',
    handleSelectTemplate: vi.fn(),
    startGameWithCharacter: vi.fn(),
    handleCreateCharacter: vi.fn(),
    getModifier: vi.fn(() => '+0'),
    playthroughChoices: mockPlaythroughChoices,
    choosePlaythrough: mockChoosePlaythrough,
    clearPlaythroughChoices: mockClearPlaythroughChoices,
  })),
}));

const rows: SavedPlaythrough[] = [
  {
    characterId: 'char-esme-a',
    campaignId: 'camp-1',
    name: 'Esme Aldgate',
    hpCurrent: 12,
    hpMax: 28,
    sessionNumber: 2,
    lastPlayedAt: null,
    finished: false,
    fallen: false,
  },
  {
    characterId: 'char-esme-b',
    campaignId: 'camp-1',
    name: 'Esme Aldgate',
    hpCurrent: 28,
    hpMax: 28,
    sessionNumber: 1,
    lastPlayedAt: null,
    finished: true,
    fallen: false,
  },
];

const renderModal = (): ReturnType<typeof render> =>
  render(
    <CharacterSelectionModal
      isOpen
      onClose={() => undefined}
      campaignId="camp-1"
      campaignName="The Last Bout"
    />,
  );

describe('CharacterSelectionModal playthrough picker (#1380)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPlaythroughChoices = rows;
  });

  it('shows the picker rows and continues the chosen character', () => {
    renderModal();

    expect(screen.getByText('Choose a saved playthrough')).toBeInTheDocument();
    // NOTE: role queries cannot see these rows in jsdom — Radix stacks two
    // modal dialogs here (picker over the character picker) and its
    // aria-hidden handling hides both layers in this environment, while
    // browsers keep the topmost dialog interactive. The rows are real
    // <button>s (SavedPlaythroughList, whose own tests cover roles), so
    // this test queries by text and clicks the button element itself.
    const firstRow = screen.getByText(/Esme Aldgate · HP 12\/28 · Session 2/);
    expect(firstRow).toBeInTheDocument();
    expect(
      screen.getByText(/Esme Aldgate · HP 28\/28 · Session 1 · last played unknown · Finished/),
    ).toBeInTheDocument();

    fireEvent.click(firstRow);

    expect(mockChoosePlaythrough).toHaveBeenCalledWith(rows[0]);
  });

  it('shows no picker when there are no choices', () => {
    mockPlaythroughChoices = null;
    renderModal();

    expect(screen.queryByText('Choose a saved playthrough')).not.toBeInTheDocument();
  });
});
