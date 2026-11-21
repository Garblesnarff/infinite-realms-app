/**
 * #213 QA-051: Finalize summary shows spells, equipment, enhancements, physical traits.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CharacterAction } from '@/contexts/character/character-reducer';
import type { Character } from '@/types/character';

import CharacterFinalization from '@/components/character-creation/steps/CharacterFinalization';
import { initialState, characterReducer } from '@/contexts/character/character-reducer';
import { wizard } from '@/data/classes/wizard';

let mockCharacter: Partial<Character> = {};

vi.mock('@/services/character-description-generator', () => ({
  characterDescriptionGenerator: { generateDescription: vi.fn() },
}));

vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => ({
    state: { character: mockCharacter },
    dispatch: vi.fn(),
  }),
}));

vi.mock('@/contexts/CampaignContext', () => ({
  useCampaign: () => ({ state: { campaign: null } }),
}));

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: () => {} }) }));

vi.mock('@/services/openrouter-service', () => ({ openRouterService: { uploadImage: vi.fn() } }));

function buildState(actions: CharacterAction[]): ReturnType<typeof characterReducer> {
  let state = initialState;
  for (const action of actions) {
    state = characterReducer(state, action);
  }
  return state;
}

function renderSummary(character: Partial<Character>): void {
  mockCharacter = { name: 'Hero', description: '', theme: 'fantasy', ...character };
  render(
    <MemoryRouter>
      <CharacterFinalization />
    </MemoryRouter>,
  );
}

describe('finalize summary choices (#213)', () => {
  beforeEach(() => {
    mockCharacter = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('no network in test'))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows spells, equipment, an enhancement and physical traits', () => {
    const state = buildState([
      { type: 'SET_GENDER', payload: 'female' },
      { type: 'SET_AGE', payload: 27 },
      { type: 'SET_HEIGHT', payload: 70 },
      { type: 'SET_WEIGHT', payload: 150 },
      { type: 'SET_EYES', payload: 'green' },
      { type: 'SET_SKIN', payload: 'tan' },
      { type: 'SET_HAIR', payload: 'black' },
      { type: 'UPDATE_CHARACTER', payload: { class: wizard } },
      {
        type: 'UPDATE_CHARACTER',
        payload: { equipment: ['Quarterstaff', 'Spellbook'], selectedEquipmentOptionIndex: 0 },
      },
      {
        type: 'UPDATE_CHARACTER',
        payload: { cantrips: ['fire-bolt'], knownSpells: ['magic-missile'] },
      },
      {
        type: 'UPDATE_CHARACTER',
        payload: {
          enhancementSelections: [
            { optionId: 'quirks', value: ['Counts everything they encounter'] },
          ],
        },
      },
    ]);
    renderSummary(state.character as Partial<Character>);

    expect(screen.getByTestId('summary-spells')).toBeTruthy();
    const spellsText = screen.getByTestId('summary-spells').textContent ?? '';
    expect(spellsText).toContain('Spells');
    expect(spellsText).toContain('Fire Bolt');
    expect(spellsText).toContain('Magic Missile');

    const equipmentParent = screen.getByText('Equipment:').parentElement?.textContent ?? '';
    expect(equipmentParent).not.toBe('Equipment: No equipment chosen');
    expect(equipmentParent).toContain('Quarterstaff');
    expect(equipmentParent).toContain('Spellbook');

    expect(screen.getByRole('heading', { name: 'Spells' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Enhancements' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Physical Traits' })).toBeTruthy();

    expect(screen.getByTestId('summary-enhancements')).toBeTruthy();
    const enhText = screen.getByTestId('summary-enhancements').textContent ?? '';
    expect(enhText).toContain('Character Quirks: Counts everything they encounter');

    expect(screen.getByTestId('summary-physical')).toBeTruthy();
    const physText = screen.getByTestId('summary-physical').textContent ?? '';
    expect(physText).toContain('Gender: Female');
    expect(physText).toContain('Height: 5\'10"');
    expect(physText).toContain('Eyes: green');

    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('a hero with no choices shows no empty headings', () => {
    const state = buildState([
      { type: 'UPDATE_CHARACTER', payload: { name: 'Hero', class: wizard } },
    ]);
    renderSummary(state.character as Partial<Character>);

    expect(screen.getByText('Character Summary')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Spells' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Enhancements' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Physical Traits' })).toBeNull();
    expect(screen.queryByTestId('summary-spells')).toBeNull();
    expect(screen.queryByTestId('summary-enhancements')).toBeNull();
    expect(screen.queryByTestId('summary-physical')).toBeNull();

    const alignmentLine = screen.getByText('Alignment:').parentElement?.textContent ?? '';
    expect(alignmentLine).toBe('Alignment: Not set');

    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});
