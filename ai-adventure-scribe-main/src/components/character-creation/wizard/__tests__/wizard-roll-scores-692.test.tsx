/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #692 (Hark D4-015): Roll Scores blocked Continue with "Please Complete This
 * Step" after all six scores were rolled, including after a Reroll.
 *
 * Drives the REAL wizard: real step list and reducer, the real AbilityScores
 * step with its Roll Scores tab, the real Roll New Scores and Reroll producers,
 * and the real Continue button (StepNavigation -> handleNext -> validateStep).
 * Only the save hook and toast are stubbed, as in wizard-half-elf-897.test.tsx.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { wizardSteps } from '../constants';
import WizardContent from '../WizardContent';

import type { Character } from '@/types/character';

import { initialState, characterReducer } from '@/contexts/character/character-reducer';
import { backgrounds } from '@/data/backgroundOptions';
import { fighter } from '@/data/classes/fighter';

const harness = vi.hoisted(() => ({
  current: null as { state: any; dispatch: React.Dispatch<any> } | null,
  navigate: null as null | ((path: string) => void),
  search: '',
  toast: vi.fn(),
  saveCharacter: vi.fn(async (character: Character) => ({ ...character, id: 'char-692' })),
}));

vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => harness.current,
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-692' } }),
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

function renderWizard(): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={['/app/characters/new?step=0']}>
      <StateHarness />
    </MemoryRouter>,
  );
}

function character(): Character {
  return harness.current!.state.character as Character;
}

function stepIndex(label: string): number {
  const steps = wizardSteps.filter((step) =>
    step.skipCondition ? !step.skipCondition(character()) : true,
  );
  const idx = steps.findIndex((s) => s.label === label);
  if (idx < 0) throw new Error(`step ${label} not in filtered list`);
  return idx;
}

async function goToStep(label: string): Promise<void> {
  const idx = stepIndex(label);
  await act(async () => {
    harness.navigate!(`/app/characters/new?step=${idx}`);
  });
}

function seedBasics(name: string): void {
  act(() => {
    harness.current!.dispatch({
      type: 'UPDATE_CHARACTER',
      payload: {
        name,
        class: fighter,
        background: backgrounds.find((b) => b.id === 'acolyte') ?? null,
        savingThrowProficiencies: ['strength', 'constitution'],
      },
    });
  });
}

function openRollTab(): void {
  // Radix Tabs activate on mousedown, not click.
  const tab = screen.getByRole('tab', { name: 'Roll Scores' });
  fireEvent.mouseDown(tab);
  fireEvent.click(tab);
}

function blockingToasts(): unknown[] {
  return harness.toast.mock.calls.filter(
    ([arg]) => arg?.title === 'Please Complete This Step',
  );
}

describe('#692 Roll Scores through the real wizard', () => {
  beforeEach(() => {
    harness.toast.mockClear();
    harness.current = null;
    harness.navigate = null;
  });

  it('Roll New Scores, then Continue advances past Ability Scores', async () => {
    renderWizard();
    seedBasics('Stranger Scout');
    await goToStep('Ability Scores');
    await screen.findByRole('tab', { name: 'Roll Scores' });

    openRollTab();
    fireEvent.click(screen.getByRole('button', { name: 'Roll new scores for all abilities' }));

    const scores = Object.values(character().abilityScores!).map((a: any) => a.score);
    expect(scores).toHaveLength(6);
    expect(scores.every((s: number) => s >= 3 && s <= 18)).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(blockingToasts()).toEqual([]);
    expect(new URLSearchParams(harness.search).get('step')).toBe(String(stepIndex('Background')));
  });

  it('Roll, Reroll one ability, then Continue advances past Ability Scores', async () => {
    renderWizard();
    seedBasics('Stranger Scout');
    await goToStep('Ability Scores');

    openRollTab();
    fireEvent.click(screen.getByRole('button', { name: 'Roll new scores for all abilities' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Reroll strength' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(blockingToasts()).toEqual([]);
  });

  it('negative control: scores below the roll minimum are blocked with the toast', async () => {
    renderWizard();
    seedBasics('Stranger Scout');
    await goToStep('Ability Scores');
    const low = Object.fromEntries(
      ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'].map((a) => [
        a,
        { score: 1, modifier: -5, savingThrow: false },
      ]),
    );
    act(() => {
      harness.current!.dispatch({ type: 'UPDATE_CHARACTER', payload: { abilityScores: low } });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(blockingToasts()).toHaveLength(1);
    expect(new URLSearchParams(harness.search).get('step')).toBe(String(stepIndex('Ability Scores')));
  });
});
