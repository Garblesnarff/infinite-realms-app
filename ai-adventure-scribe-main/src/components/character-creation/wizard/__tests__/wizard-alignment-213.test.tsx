/* eslint-disable @typescript-eslint/no-explicit-any */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import WizardContent from '../WizardContent';

import type { Character } from '@/types/character';

import { wizardSteps } from '@/components/character-creation/wizard/constants';
import { initialState, characterReducer } from '@/contexts/character/character-reducer';
import { backgrounds } from '@/data/backgroundOptions';
import { rogue } from '@/data/classes/rogue';
import { halfOrc } from '@/data/races/half-orc';

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

function LocationProbe(): React.JSX.Element {
  const location = useLocation();
  return <div data-testid="location-search">{location.pathname + location.search}</div>;
}

function StateHarness({ seed }: { seed: Character }): React.JSX.Element {
  const [state, dispatch] = React.useReducer(characterReducer, {
    ...initialState,
    character: seed,
  });
  harness.current = { state, dispatch: dispatch as React.Dispatch<any> };
  return (
    <>
      <NavProbe />
      <LocationProbe />
      <WizardContent />
    </>
  );
}

function renderWizard(seed: Character, initialEntry: string): ReturnType<typeof render> {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[initialEntry]}>
        <StateHarness seed={seed} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function character(): Character {
  return harness.current!.state.character as Character;
}

/** Filtered-list index of a step label for the current character state. */
function filteredStepIndex(label: string): number {
  const steps = wizardSteps.filter((step) =>
    step.skipCondition ? !step.skipCondition(character()) : true,
  );
  const idx = steps.findIndex((s) => s.label === label);
  if (idx < 0) throw new Error(`step ${label} not in filtered list`);
  return idx;
}

async function goToStep(label: string): Promise<void> {
  const idx = filteredStepIndex(label);
  await act(async () => {
    harness.navigate!(`/app/characters/new?step=${idx}`);
  });
}

/** An otherwise-complete rogue build whose alignment was never set. */
function unalignedRogue(): Character {
  return {
    ...initialState.character,
    name: 'Vex Marlowe',
    race: halfOrc,
    class: rogue,
    background: backgrounds.find((b) => b.id === 'charlatan') ?? null,
    skillProficiencies: ['Stealth', 'Acrobatics', 'Deception', 'Sleight of Hand'],
    languages: ['Common', 'Orc'],
    equipment: ['Rapier', 'Shortbow'],
  } as Character;
}

describe('#213 alignment step through the real wizard flow', () => {
  beforeEach(() => {
    if (typeof global.ResizeObserver === 'undefined') {
      global.ResizeObserver = class ResizeObserver {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      };
    }
    harness.toast.mockClear();
    harness.saveCharacter.mockClear();
    harness.current = null;
    harness.navigate = null;
    window.localStorage.clear();
  });

  it('alignment set on the Alignment step shows on the finalization summary', async () => {
    renderWizard(initialState.character as Character, '/app/characters/new?step=0');
    await goToStep('Alignment');
    expect(await screen.findByText(/Choose your character.*moral outlook/)).toBeTruthy();

    // The real step UI: pick an alignment; the reducer holds it.
    fireEvent.click(screen.getByLabelText(/Chaotic Good/));
    expect(character().alignment).toBe('Chaotic Good');

    // Clear puts it back to unset.
    fireEvent.click(screen.getByText('Clear selection'));
    expect(character().alignment).toBe('');
    fireEvent.click(screen.getByLabelText(/Chaotic Good/));

    // Jump to the last step (the URL sync clamps 99 to finalization).
    act(() => {
      harness.navigate!('/app/characters/new?step=99');
    });
    expect(await screen.findByText('Finalize Your Character')).toBeTruthy();
    // The summary row and the preview sidebar both show the alignment, so
    // match the summary row by its full text, not the bare name.
    expect(
      screen.getByText((_content, el) => el?.textContent === 'Alignment: Chaotic Good'),
    ).toBeTruthy();
  });

  it('alignment rides the save call', async () => {
    const seed = unalignedRogue();
    expect(seed.alignment).toBe('');
    renderWizard(seed, '/app/characters/new?step=0');
    await goToStep('Alignment');
    expect(await screen.findByText(/Choose your character.*moral outlook/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText(/Lawful Good/));
    expect(character().alignment).toBe('Lawful Good');

    await goToStep('Finalization');
    expect(await screen.findByText('Finalize Your Character')).toBeTruthy();
    expect(
      screen.getByText((_content, el) => el?.textContent === 'Alignment: Lawful Good'),
    ).toBeTruthy();

    fireEvent.click(screen.getByText('Complete Character'));

    await waitFor(() => {
      expect(harness.saveCharacter).toHaveBeenCalledTimes(1);
    });
    expect(harness.saveCharacter.mock.calls[0]?.[0]).toMatchObject({
      name: 'Vex Marlowe',
      alignment: 'Lawful Good',
    });
  });

  it('leaving alignment unset still lets the wizard continue and save', async () => {
    const seed = unalignedRogue();
    renderWizard(seed, '/app/characters/new?step=0');
    await goToStep('Alignment');
    expect(await screen.findByText(/Choose your character.*moral outlook/)).toBeTruthy();

    // No validator entry for Alignment: Continue works with nothing chosen.
    fireEvent.click(screen.getByText('Continue'));
    expect(await screen.findByText('Define Your Character')).toBeTruthy();
    expect(character().alignment).toBe('');

    // And the save still goes through with alignment unset.
    await goToStep('Finalization');
    expect(await screen.findByText('Finalize Your Character')).toBeTruthy();
    fireEvent.click(screen.getByText('Complete Character'));

    await waitFor(() => {
      expect(harness.saveCharacter).toHaveBeenCalledTimes(1);
    });
    expect(harness.saveCharacter.mock.calls[0]?.[0]).toMatchObject({
      name: 'Vex Marlowe',
      alignment: '',
    });
  });
});
