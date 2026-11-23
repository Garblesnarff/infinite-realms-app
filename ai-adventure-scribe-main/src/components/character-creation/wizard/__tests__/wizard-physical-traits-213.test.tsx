/* eslint-disable @typescript-eslint/no-explicit-any */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import WizardContent from '../WizardContent';

import type { Character } from '@/types/character';

import { initialState, characterReducer } from '@/contexts/character/character-reducer';
import { baseRaces } from '@/data/raceOptions';

const harness = vi.hoisted(() => ({
  current: null as { state: any; dispatch: React.Dispatch<any> } | null,
  navigate: null as null | ((path: string) => void),
  search: '',
  toast: vi.fn(),
  saveCharacter: vi.fn(async (character: Character) => ({ ...character, id: 'char-213' })),
}));

vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => harness.current,
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-213' } }),
}));
vi.mock('@/contexts/CampaignContext', () => ({
  useCampaign: () => ({ state: { campaign: null } }),
}));
vi.mock('@/hooks/use-character-save', () => ({
  useCharacterSave: () => ({ saveCharacter: harness.saveCharacter, isSaving: false }),
}));
vi.mock('@/hooks/use-auto-scroll', () => ({
  useAutoScroll: () => ({
    scrollToTop: () => {},
    scrollToNavigation: () => {},
    scrollToBottom: () => {},
    scrollToElement: () => {},
  }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: harness.toast }) }));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/services/character-background-generator', () => ({
  characterBackgroundGenerator: { generateCharacterBackground: vi.fn(async () => '') },
}));
vi.mock('@/services/characterSpellApi', () => ({
  characterSpellService: { saveCharacterSpells: vi.fn(async () => undefined) },
}));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    createCharacter: vi.fn(),
    updateCharacter: vi.fn(),
    updateCharacterStats: vi.fn(),
    listCharacters: vi.fn(async () => []),
  },
}));
vi.mock('@/utils/spell-id-mapping', () => ({
  convertSpellIdsToDatabase: vi.fn(() => []),
}));
vi.mock('@/infrastructure/api', async (importOriginal) => {
  const original = (await importOriginal()) as {
    llmApiClient: Record<string, unknown>;
    [key: string]: unknown;
  };
  return {
    ...original,
    llmApiClient: { ...original.llmApiClient, getImageQuotaStatus: async () => null },
  };
});

function NavProbe(): null {
  harness.navigate = useNavigate();
  harness.search = useLocation().search;
  return null;
}

function StateHarness(): React.JSX.Element {
  const [state, dispatch] = React.useReducer(characterReducer, initialState);
  harness.current = { state, dispatch: dispatch as React.Dispatch<any> };
  return (
    <>
      <NavProbe />
      <WizardContent />
    </>
  );
}

function renderWizard(initialEntry: string): ReturnType<typeof render> {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[initialEntry]}>
        <StateHarness />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('#213 physical traits through the real wizard flow', () => {
  beforeEach(() => {
    if (typeof global.ResizeObserver === 'undefined') {
      global.ResizeObserver = class ResizeObserver {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      };
    }
    harness.toast.mockClear();
    harness.current = null;
    harness.navigate = null;
    window.localStorage.clear();
  });

  it('traits set on the Physical step UI survive navigation to the summary step', async () => {
    // With a bare character the Subrace step is skipped, so Physical is index 2
    // in the filtered list (Basic Info 0, Race 1, Physical 2, Class 3, ...).
    renderWizard('/app/characters/new?step=2');
    expect(await screen.findByText('Physical Appearance')).toBeTruthy();

    // The real Physical step UI: radio, inputs, sliders.
    fireEvent.click(screen.getByLabelText('Female'));
    fireEvent.change(screen.getByLabelText('Age (years)'), { target: { value: '27' } });
    fireEvent.change(screen.getByLabelText('Eye Color'), { target: { value: 'green' } });
    fireEvent.change(screen.getByLabelText('Skin Color'), { target: { value: 'tan' } });
    fireEvent.change(screen.getByLabelText('Hair Color'), { target: { value: 'black' } });
    const sliders = screen.getAllByRole('slider');
    expect(sliders).toHaveLength(2);
    const [heightThumb, weightThumb] = sliders as HTMLElement[];
    for (let i = 0; i < 10; i += 1) fireEvent.keyDown(heightThumb, { key: 'ArrowRight' });
    for (let i = 0; i < 34; i += 1) fireEvent.keyDown(weightThumb, { key: 'ArrowRight' });

    // The step's own handlers wrote the fields into the real reducer.
    const character = harness.current!.state.character;
    expect(character.gender).toBe('female');
    expect(character.age).toBe(27);
    expect(character.height).toBe(58);
    expect(character.weight).toBe(114);
    expect(character.eyes).toBe('green');
    expect(character.skin).toBe('tan');
    expect(character.hair).toBe('black');

    // Jump to the last step (the URL sync clamps 99 to finalization).
    act(() => {
      harness.navigate!('/app/characters/new?step=99');
    });
    const section = await screen.findByTestId('summary-physical');
    expect(section).toBeTruthy();
    expect(screen.getByText('4\'10"')).toBeTruthy();
    expect(screen.getByText('114 lbs')).toBeTruthy();
    expect(screen.getByText('27 years')).toBeTruthy();
    expect(screen.getByText('Female')).toBeTruthy();
    expect(screen.getByText('green')).toBeTruthy();
    expect(screen.getByText('tan')).toBeTruthy();
    expect(screen.getByText('black')).toBeTruthy();
    // The URL keeps step=99; the sync effect clamps the step STATE to the last
    // filtered step (finalization), which is what rendered the summary above.
    expect(await screen.findByText('Finalize Your Character')).toBeTruthy();
  });

  it('a Human who accepts the displayed height/weight defaults sees them on the summary', async () => {
    // Real order: the race step comes before the Physical step.
    renderWizard('/app/characters/new?step=1');
    expect(await screen.findByText(/Your race determines/)).toBeTruthy();

    // The race step's own action, with the real race object it renders.
    const human = baseRaces.find((race) => race.id === 'human');
    expect(human?.heightRange).toEqual([58, 76]);
    expect(human?.weightRange?.[0]).toBe(114);
    act(() => {
      harness.current!.dispatch({ type: 'UPDATE_CHARACTER', payload: { race: human } });
    });

    // A Human has subraces, so the Physical step is index 3.
    act(() => {
      harness.navigate!('/app/characters/new?step=3');
    });
    expect(await screen.findByText('Physical Appearance')).toBeTruthy();
    // The step DISPLAYS the race minima even though nothing is in state yet.
    expect(screen.getByText('4\'10"')).toBeTruthy();
    expect(screen.getByText('114 lbs')).toBeTruthy();

    // No slider touch: the user accepts the displayed values and continues.
    act(() => {
      harness.navigate!('/app/characters/new?step=99');
    });
    const section = await screen.findByTestId('summary-physical');
    expect(section).toBeTruthy();
    expect(screen.getByText('4\'10"')).toBeTruthy();
    expect(screen.getByText('114 lbs')).toBeTruthy();
  });

  it('switching race after visiting Physical follows the new race minima (self-review)', async () => {
    renderWizard('/app/characters/new?step=1');
    expect(await screen.findByText(/Your race determines/)).toBeTruthy();

    const human = baseRaces.find((race) => race.id === 'human');
    const halfling = baseRaces.find((race) => race.id === 'halfling');
    expect(human?.heightRange).toEqual([58, 76]);
    expect(halfling?.heightRange).toEqual([33, 39]);
    expect(halfling?.weightRange?.[0]).toBe(37);
    act(() => {
      harness.current!.dispatch({ type: 'UPDATE_CHARACTER', payload: { race: human } });
    });
    act(() => {
      harness.navigate!('/app/characters/new?step=3');
    });
    expect(await screen.findByText('Physical Appearance')).toBeTruthy();
    // Visiting the step auto-initialized the Human minima.
    expect(harness.current!.state.character.height).toBe(58);
    expect(harness.current!.state.character.weight).toBe(114);

    // The race step's own action when the race changes (subrace resets too).
    act(() => {
      harness.current!.dispatch({
        type: 'UPDATE_CHARACTER',
        payload: { race: halfling, subrace: null },
      });
    });
    // Still on the Physical step; the auto-defaults follow the new race.
    expect(await screen.findByText('2\'9"')).toBeTruthy();
    expect(screen.getByText('37 lbs')).toBeTruthy();
    expect(harness.current!.state.character.height).toBe(33);
    expect(harness.current!.state.character.weight).toBe(37);

    act(() => {
      harness.navigate!('/app/characters/new?step=99');
    });
    const section = await screen.findByTestId('summary-physical');
    expect(section).toBeTruthy();
    expect(screen.getByText('2\'9"')).toBeTruthy();
    expect(screen.getByText('37 lbs')).toBeTruthy();
  });
});
