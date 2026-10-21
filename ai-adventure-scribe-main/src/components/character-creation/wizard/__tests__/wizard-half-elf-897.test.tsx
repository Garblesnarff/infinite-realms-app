import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #897 (Hark D20-002/012): Half-Elf racial bonuses (+2 CHA, +1/+1 chosen)
 * were reported lost (sheet shows pre-racial scores) or misplaced (+1/+1
 * on the wrong abilities) on builds 43a2a4d7/e8a0e324. On current main
 * neither shape reproduces; these tests pin the correct behaviour through
 * the REAL wizard so a regression in any single hop fails loudly:
 * real step list + real reducer, the real RaceSelection card and
 * HalfElfAbilityChoice modal, the real AbilityScoresSelection producers
 * (point-buy +/- buttons; standard-array Apply + assign swaps), the
 * final step's displayed scores, and the real useCharacterSave hook's
 * POST body. The route/stored/sheet legs for these bodies are pinned by
 * server-bun/src/routes/v1/__tests__/character-create-half-elf.real-db.test.ts
 * on the shared fixtures in shared/test-fixtures/half-elf-*-create.json;
 * the fixture cases below produce exactly those fixtures' body stats from
 * wizard state, chaining the two suites (#996 completed the point-buy
 * leg, which previously rested on a fixture captured from hand-built
 * state rather than from the wizard producers).
 * Fixtures follow the wizard's own producers: name/class/background are
 * seeded with the same UPDATE_CHARACTER payloads those steps dispatch;
 * every score and choice is entered through the step UI. One exception:
 * the standard-array method switch dispatches the same
 * abilityScoreMethod payload the method tab dispatches, before the step
 * mounts; the Apply/assign producers that move scores are real UI.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { wizardSteps } from '../constants';
import {
  getWizardDraftKey,
  readWizardDraft,
  WIZARD_DRAFT_VERSION,
  writeWizardDraft,
} from '../wizard-draft';
import WizardContent from '../WizardContent';

import type { Character } from '@/types/character';

import { initialState, characterReducer } from '@/contexts/character/character-reducer';
import { backgrounds } from '@/data/backgroundOptions';
import { fighter } from '@/data/classes/fighter';
import { userDataApi } from '@/services/user-data-api';
import { prepareCharacterPayload } from '@/services/user-data-payload-helpers';

const harness = vi.hoisted(() => ({
  current: null as { state: any; dispatch: React.Dispatch<any> } | null,
  navigate: null as null | ((path: string) => void),
  toast: vi.fn(),
  saveCharacter: vi.fn(async (character: Character) => ({ ...character, id: 'char-897' })),
}));

vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => harness.current,
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-897' } }),
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

function scoresOf(c: Character): Record<string, number> {
  return Object.fromEntries(
    Object.entries(c.abilityScores!).map(([a, v]) => [a, (v as { score: number }).score]),
  );
}

/** Seed the fields the Basic Info / Class steps dispatch (orthogonal producers). */
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

async function chooseHalfElf(choices: [string, string]): Promise<void> {
  await goToStep('Race');
  await screen.findByText('Choose Your Race');
  fireEvent.click(screen.getByRole('button', { name: 'Select Half-Elf race' }));
  const dialog = await screen.findByRole('dialog');
  for (const label of choices) {
    fireEvent.click(within(dialog).getByText(label, { selector: 'h4' }));
  }
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm Choices' }));
}

/** Read the scores shown in the final step's own statistics section. */
function displayedScores(): Record<string, number> {
  const section = document.querySelector('section[aria-label="Final character statistics"]');
  if (!section) throw new Error('final-step statistics section missing');
  const html = section.innerHTML;
  const out: Record<string, number> = {};
  for (const ability of [
    'strength',
    'dexterity',
    'constitution',
    'intelligence',
    'wisdom',
    'charisma',
  ]) {
    const m = html.match(
      new RegExp(`${ability}</span>[\\s\\S]*?font-bold text-sm">(\\d+)</div>`),
    );
    if (!m) throw new Error(`displayed score for ${ability} not found`);
    out[ability] = Number(m[1]);
  }
  return out;
}

const saveWrapper = ({ children }: { children: React.ReactNode }): React.ReactElement => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

async function saveBodyFor(c: Character): Promise<any> {
  const actual = await vi.importActual<any>('@/hooks/use-character-save');
  const { result } = renderHook(() => actual.useCharacterSave(), { wrapper: saveWrapper });
  await act(async () => {
    await result.current.saveCharacter(c);
  });
  const calls = vi.mocked(userDataApi.createCharacter).mock.calls;
  expect(calls.length).toBe(1);
  return prepareCharacterPayload(calls[0][0]);
}

describe('#897 Half-Elf bonuses through the real wizard', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(userDataApi.createCharacter).mockResolvedValue({ id: 'char-897' } as any);
    vi.mocked(userDataApi.updateCharacter).mockResolvedValue({} as any);
    vi.mocked(userDataApi.updateCharacterStats).mockResolvedValue({} as any);
  });

  /**
   * Reset to 8s, then click the real +/- buttons up to the given point-buy
   * base. Entries run in the target's key order (STR -> CHA); every target
   * used here stays within the 27-point budget at each prefix, so no
   * Increase click is ever disabled mid-sequence.
   */
  async function drivePointBuyBase(
    target: Record<string, number> = {
      strength: 15, // 8 -> 15 (9 pts)
      dexterity: 13, // 8 -> 13 (5 pts)
      constitution: 14, // 8 -> 14 (7 pts)
      intelligence: 8,
      wisdom: 10, // 8 -> 10 (2 pts)
      charisma: 12, // 8 -> 12 (4 pts) = 27 total
    },
  ): Promise<void> {
    await goToStep('Ability Scores');
    await screen.findByText('Assign Ability Scores');
    // Wizard starts from all-10s; a point-buy user resets to 8s first.
    fireEvent.click(screen.getByRole('button', { name: 'Reset ability scores' }));
    const clickPlus = (ability: string, times: number): void => {
      for (let i = 0; i < times; i++) {
        fireEvent.click(screen.getByRole('button', { name: `Increase ${ability}` }));
      }
    };
    for (const [ability, score] of Object.entries(target)) {
      clickPlus(ability, score - 8);
    }
    expect(scoresOf(character())).toEqual(target);
  }

  const PB_FINAL = {
    strength: 16,
    dexterity: 14,
    constitution: 14,
    intelligence: 8,
    wisdom: 10,
    charisma: 14,
  };

  it('point buy: chosen +1/+1 on STR/DEX land exactly; final step == save body', async () => {
    renderWizard();
    seedBasics('Half-Elf Probe PB');

    await chooseHalfElf(['Strength', 'Dexterity']);
    expect(character().race?.id).toBe('half-elf');
    expect(character().racialAbilityChoices?.halfElf).toEqual(['strength', 'dexterity']);

    await drivePointBuyBase();

    await goToStep('Finalization');
    await screen.findByText('Finalize Your Character');
    const shown = displayedScores();
    expect(shown).toEqual(PB_FINAL);

    const body = await saveBodyFor(character());
    expect(body.stats).toEqual(PB_FINAL);
  });

  it('point buy: bonuses survive the wizard draft save/resume round trip', async () => {
    const first = renderWizard();
    seedBasics('Half-Elf Probe Draft');
    await chooseHalfElf(['Strength', 'Dexterity']);
    await drivePointBuyBase();

    // The draft serializer's own write/read pair (WizardContent's onRestore
    // then dispatches SET_CHARACTER with the parsed character).
    const key = getWizardDraftKey('user-897', null);
    writeWizardDraft(key, {
      version: WIZARD_DRAFT_VERSION,
      character: character(),
      step: 1,
      campaignId: null,
      updatedAt: new Date().toISOString(),
    });
    const draft = readWizardDraft(key);
    expect(draft).not.toBeNull();
    first.unmount();

    renderWizard();
    act(() => {
      harness.current!.dispatch({ type: 'SET_CHARACTER', payload: draft!.character });
    });
    expect(character().racialAbilityChoices?.halfElf).toEqual(['strength', 'dexterity']);
    await goToStep('Finalization');
    await screen.findByText('Finalize Your Character');
    const shown = displayedScores();
    expect(shown).toEqual(PB_FINAL);
    const body = await saveBodyFor(character());
    expect(body.stats).toEqual(PB_FINAL);
  });

  it('point buy: the shared-fixture combo produces exactly the fixture body stats', async () => {
    renderWizard();
    seedBasics('Half-Elf pointBuy');

    await chooseHalfElf(['Constitution', 'Wisdom']);
    expect(character().race?.id).toBe('half-elf');
    expect(character().racialAbilityChoices?.halfElf).toEqual(['constitution', 'wisdom']);

    // The shared fixture's point-buy base (27 points), entered through the
    // real +/- producers like the other point-buy cases.
    await drivePointBuyBase({
      strength: 8,
      dexterity: 14,
      constitution: 13,
      intelligence: 10,
      wisdom: 12,
      charisma: 15,
    });

    await goToStep('Finalization');
    await screen.findByText('Finalize Your Character');
    const fixture = JSON.parse(
      readFileSync(
        resolve(process.cwd(), 'shared/test-fixtures/half-elf-pointBuy-create.json'),
        'utf8',
      ),
    );
    const shown = displayedScores();
    expect(shown).toEqual(fixture.final);
    const body = await saveBodyFor(character());
    expect(body.stats).toEqual(fixture.body.stats);
  });

  async function runStandardArray(
    name: string,
    choiceLabels: [string, string],
    expectedChoices: [string, string],
  ): Promise<{ shown: Record<string, number>; body: any }> {
    seedBasics(name);
    await chooseHalfElf(choiceLabels);
    expect(character().racialAbilityChoices?.halfElf).toEqual(expectedChoices);

    // The method tab dispatches exactly this payload on switch.
    act(() => {
      harness.current!.dispatch({
        type: 'UPDATE_CHARACTER',
        payload: { abilityScoreMethod: 'standardArray' },
      });
    });
    await goToStep('Ability Scores');
    await screen.findByText('Assign Ability Scores');
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Apply the standard array of scores (15, 14, 13, 12, 10, 8)',
      }),
    );
    expect(scoresOf(character())).toEqual({
      strength: 15,
      dexterity: 14,
      constitution: 13,
      intelligence: 12,
      wisdom: 10,
      charisma: 8,
    });
    const assign = (ability: string, value: string): void => {
      fireEvent.change(screen.getByLabelText(`Assign standard array ${ability}`), {
        target: { value },
      });
    };
    assign('charisma', '15'); // swap STR<->CHA
    assign('dexterity', '12'); // swap DEX<->INT
    assign('intelligence', '10'); // swap INT<->WIS
    // The shared fixture's base for both standard-array cases.
    expect(scoresOf(character())).toEqual({
      strength: 8,
      dexterity: 12,
      constitution: 13,
      intelligence: 10,
      wisdom: 14,
      charisma: 15,
    });

    await goToStep('Finalization');
    await screen.findByText('Finalize Your Character');
    const shown = displayedScores();
    const body = await saveBodyFor(character());
    return { shown, body };
  }

  it('standard array: chosen +1/+1 on CON/WIS (the D20-012 pair) land exactly', async () => {
    renderWizard();
    const { shown, body } = await runStandardArray(
      'Half-Elf SA CON/WIS',
      ['Constitution', 'Wisdom'],
      ['constitution', 'wisdom'],
    );
    const expectedFinal = {
      strength: 8,
      dexterity: 12,
      constitution: 14,
      intelligence: 10,
      wisdom: 15,
      charisma: 17,
    };
    expect(shown).toEqual(expectedFinal);
    expect(body.stats).toEqual(expectedFinal);
  });

  it('standard array: the shared-fixture combo produces exactly the fixture body stats', async () => {
    renderWizard();
    const { shown, body } = await runStandardArray(
      'Half-Elf standardArray',
      ['Strength', 'Dexterity'],
      ['strength', 'dexterity'],
    );
    const fixture = JSON.parse(
      readFileSync(
        resolve(process.cwd(), 'shared/test-fixtures/half-elf-standardArray-create.json'),
        'utf8',
      ),
    );
    expect(shown).toEqual(fixture.final);
    expect(body.stats).toEqual(fixture.body.stats);
  });
});
