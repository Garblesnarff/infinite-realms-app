import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import WizardContent from '../WizardContent';

import type { Character } from '@/types/character';

import {
  initialState,
  characterReducer,
  type CharacterAction,
} from '@/contexts/character/character-reducer';
import { backgrounds } from '@/data/backgroundOptions';
import { rogue } from '@/data/classes/rogue';
import { dwarf } from '@/data/races/dwarf';
import { halfOrc } from '@/data/races/half-orc';

/**
 * #210 QA-053 + QA-026: mounts the real wizard (real step list, real
 * reducer + initial state) the way wizard-final-step-920 does.
 *
 * QA-053: Hark saw the counter total jump 12 -> 13 -> 14 as Subrace,
 * Personality and Advanced Spellcasting appeared. The track now always
 * shows the full 16 steps with a stable total; flipping the race from
 * half-orc (no subraces, 13 filtered steps) to dwarf (3 subraces, 14
 * filtered steps) mid-session must not move the counter.
 *
 * QA-026: the Finalization background-image toggle defaults on and rides
 * the wizard state into the save call.
 */

const harness = vi.hoisted(() => ({
  current: null as { state: unknown; dispatch: React.Dispatch<never> } | null,
  toast: vi.fn(),
  saveCharacter: vi.fn(
    async (character: Character, _options?: { generateBackgroundImage?: boolean }) => ({
      ...character,
      id: 'char-210',
    }),
  ),
}));

vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => harness.current,
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-210' } }),
}));

vi.mock('@/contexts/CampaignContext', () => ({
  useCampaign: () => ({ state: { campaign: null } }),
}));

vi.mock('@/hooks/use-character-save', () => ({
  useCharacterSave: () => ({ saveCharacter: harness.saveCharacter, isSaving: false }),
}));

vi.mock('@/hooks/use-auto-scroll', () => ({ useAutoScroll: () => ({ scrollToTop: () => {} }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: harness.toast }) }));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: { listCharacters: vi.fn(async () => []) },
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

function StateHarness({ seed }: { seed: Character }): React.JSX.Element {
  const [state, dispatch] = React.useReducer(characterReducer, {
    ...initialState,
    character: seed,
  });
  harness.current = { state, dispatch: dispatch as React.Dispatch<never> };
  return <WizardContent />;
}

function LocationProbe(): React.JSX.Element {
  const location = useLocation();
  return <div data-testid="location-search">{location.pathname + location.search}</div>;
}

function renderWizard(seed: Character, entry: string): ReturnType<typeof render> {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[entry]}>
        <LocationProbe />
        <StateHarness seed={seed} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** An otherwise-complete rogue build. */
function namedRogue(): Character {
  return {
    ...initialState.character,
    name: 'Vex Marlowe',
    race: halfOrc,
    class: rogue,
    background: backgrounds.find((b) => b.id === 'charlatan') ?? null,
    alignment: 'Chaotic Neutral',
    skillProficiencies: ['Stealth', 'Acrobatics', 'Deception', 'Sleight of Hand'],
    languages: ['Common', 'Orc'],
    equipment: ['Rapier', 'Shortbow'],
  } as Character;
}

describe('wizard step track (#210 QA-053)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    harness.toast.mockClear();
    harness.saveCharacter.mockClear();
  });

  it('keeps the total at 16 when a race flip adds the Subrace step', async () => {
    const seed = { ...initialState.character, race: halfOrc } as Character;
    renderWizard(seed, '/app/characters/new');

    // Half-orc seed (no class, no background) filters to 13 steps —
    // Subrace, Personality and Advanced Spellcasting all skip — but the
    // counter is the full 16-step track.
    expect(await screen.findByText('1 of 16')).toBeTruthy();
    expect(screen.getByText('Step 1 of 16')).toBeTruthy();
    // Subrace is in the track but skipped for a half-orc, so its label
    // renders greyed (opacity-50) — this proves the filtered list really
    // excludes it, not just that the counter is stable.
    const isGreyed = (el: HTMLElement) =>
      el.parentElement?.className.includes('opacity-50') ?? false;
    expect(screen.getAllByText('Subrace').some(isGreyed)).toBe(true);

    // Flip to a race with subraces: the filtered list grows 13 -> 14.
    const dispatch = harness.current?.dispatch as unknown as React.Dispatch<CharacterAction>;
    act(() => {
      dispatch({ type: 'SET_CHARACTER', payload: { ...seed, race: dwarf } });
    });

    await waitFor(() => {
      expect(screen.getByText('1 of 16')).toBeTruthy();
    });
    expect(screen.getByText('Step 1 of 16')).toBeTruthy();
    // The flip really happened: Subrace left the skipped set, so no
    // Subrace label renders greyed any more.
    expect(screen.getAllByText('Subrace').some(isGreyed)).toBe(false);
    expect(screen.getByText('Currently:')).toBeTruthy();
  });
});

describe('wizard background-image toggle (#210 QA-026)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    harness.toast.mockClear();
    harness.saveCharacter.mockClear();
  });

  it('defaults on and passes generateBackgroundImage: true to the save', async () => {
    renderWizard(namedRogue(), '/app/characters/new?step=13');

    expect(await screen.findByText('Step 16 of 16')).toBeTruthy();
    const toggle = screen.getByTestId('background-image-toggle');
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByText('Complete Character'));

    await waitFor(() => {
      expect(harness.saveCharacter).toHaveBeenCalledTimes(1);
    });
    expect(harness.saveCharacter.mock.calls[0]?.[1]).toEqual({ generateBackgroundImage: true });
  });

  it('turning it off passes generateBackgroundImage: false to the save', async () => {
    renderWizard(namedRogue(), '/app/characters/new?step=13');

    const toggle = await screen.findByTestId('background-image-toggle');
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(toggle.getAttribute('aria-checked')).toBe('false');
    });

    fireEvent.click(screen.getByText('Complete Character'));

    await waitFor(() => {
      expect(harness.saveCharacter).toHaveBeenCalledTimes(1);
    });
    expect(harness.saveCharacter.mock.calls[0]?.[1]).toEqual({ generateBackgroundImage: false });
  });
});
