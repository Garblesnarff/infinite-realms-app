import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import WizardContent from '../WizardContent';

import type { Character } from '@/types/character';

import { initialState, characterReducer } from '@/contexts/character/character-reducer';
import { backgrounds } from '@/data/backgroundOptions';
import { rogue } from '@/data/classes/rogue';
import { halfOrc } from '@/data/races/half-orc';

/**
 * #920 (Hark D2-015): a build that reaches the final step with no name saw
 * "Name: Not set" with no way to enter one, and Complete Character stayed
 * blocked. These tests mount the real wizard (real step list, real
 * finalization step, real reducer + initial state) with an otherwise-complete
 * half-orc rogue whose name is empty — the state the real producers can
 * deliver to the final step (name validation only gates the Basic Info →
 * next-step transition; drafts, the URL step param and browser history can
 * all land a build on the final step without passing it).
 */

const harness = vi.hoisted(() => ({
  current: null as { state: unknown; dispatch: React.Dispatch<never> } | null,
  toast: vi.fn(),
  saveCharacter: vi.fn(async (character: Character) => ({ ...character, id: 'char-920' })),
}));

vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => harness.current,
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-920' } }),
}));

vi.mock('@/contexts/CampaignContext', () => ({
  useCampaign: () => ({ state: { campaign: null } }),
}));

vi.mock('@/hooks/use-character-save', () => ({
  useCharacterSave: () => ({ saveCharacter: harness.saveCharacter, isSaving: false }),
}));

vi.mock('@/hooks/use-auto-scroll', () => ({ useAutoScroll: () => ({ scrollToTop: () => {} }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: harness.toast }) }));

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
  // Rendered from inside the stateful component (not passed as children) so
  // reducer updates re-render the wizard, mirroring the real
  // CharacterProvider's context-value propagation.
  return <WizardContent />;
}

function LocationProbe(): React.JSX.Element {
  const location = useLocation();
  return (
    <div data-testid="location-search">
      {location.pathname}
      {location.search}
    </div>
  );
}

/** An otherwise-complete rogue build with the name never set. */
function namelessRogue(): Character {
  return {
    ...initialState.character,
    name: '',
    race: halfOrc,
    class: rogue,
    background: backgrounds.find((b) => b.id === 'charlatan') ?? null,
    alignment: 'Chaotic Neutral',
    skillProficiencies: ['Stealth', 'Acrobatics', 'Deception', 'Sleight of Hand'],
    languages: ['Common', 'Orc'],
    equipment: ['Rapier', 'Shortbow'],
  } as Character;
}

function renderAtFinalStep(seed: Character): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={['/app/characters/new?step=12']}>
      <LocationProbe />
      <StateHarness seed={seed} />
    </MemoryRouter>,
  );
}

describe('wizard final step with a missing name (#920)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    harness.toast.mockClear();
    harness.saveCharacter.mockClear();
  });

  it('shows a name input on the final step when the name is missing', async () => {
    renderAtFinalStep(namelessRogue());

    // Half-orc rogue filters to 13 steps; the final step is index 12.
    expect(await screen.findByText('Step 13 of 13')).toBeTruthy();
    expect(screen.getByText('Finalize Your Character')).toBeTruthy();

    // The summary must offer an editable name field, not just "Not set".
    const input = screen.getByLabelText(/name:/i);
    expect(input).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('entering a name on the final step unblocks Complete Character', async () => {
    renderAtFinalStep(namelessRogue());

    const input = await screen.findByLabelText(/name:/i);
    fireEvent.change(input, { target: { value: 'Vex Marlowe' } });

    // The name rides the same UPDATE_CHARACTER state Basic Info uses: the
    // field stays mounted (latched) and reflects the stored value.
    await waitFor(() => {
      expect((input as HTMLInputElement).value).toBe('Vex Marlowe');
    });

    fireEvent.click(screen.getByText('Complete Character'));

    await waitFor(() => {
      expect(harness.saveCharacter).toHaveBeenCalledTimes(1);
    });
    expect(harness.saveCharacter.mock.calls[0]?.[0]).toMatchObject({ name: 'Vex Marlowe' });
    // Saved characters navigate away from the wizard.
    await waitFor(() => {
      expect(screen.getByTestId('location-search').textContent).toContain('/app/characters');
    });
  });

  it('Complete Character stays blocked while the name is empty', async () => {
    renderAtFinalStep(namelessRogue());

    fireEvent.click(await screen.findByText('Complete Character'));

    await waitFor(() => {
      expect(harness.toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Critical Fields Missing' }),
      );
    });
    expect(harness.saveCharacter).not.toHaveBeenCalled();
  });

  it('Previous navigates back from the final step', async () => {
    renderAtFinalStep(namelessRogue());

    expect(await screen.findByText('Step 13 of 13')).toBeTruthy();
    fireEvent.click(screen.getByText('Previous'));

    await waitFor(() => {
      expect(screen.getByTestId('location-search').textContent).toContain('step=11');
    });
    expect(await screen.findByText('Step 12 of 13')).toBeTruthy();
    // The rendered step actually changes, not just the URL.
    expect(screen.getAllByText('Character Enhancements').length).toBeGreaterThan(0);
    expect(screen.queryByText('Finalize Your Character')).toBeNull();
  });

  it('Previous still navigates after a blocked Complete Character click', async () => {
    renderAtFinalStep(namelessRogue());

    expect(await screen.findByText('Step 13 of 13')).toBeTruthy();
    fireEvent.click(screen.getByText('Complete Character'));
    await waitFor(() => {
      expect(harness.toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Critical Fields Missing' }),
      );
    });

    fireEvent.click(screen.getByText('Previous'));

    await waitFor(() => {
      expect(screen.getByTestId('location-search').textContent).toContain('step=11');
    });
    expect(await screen.findByText('Step 12 of 13')).toBeTruthy();
  });

  it('an invalid-but-present name can be fixed in place on the final step', async () => {
    // The same bypass paths that skip the presence check also skip Basic
    // Info's validity rule: a draft can carry a name the save gate rejects.
    renderAtFinalStep({ ...namelessRogue(), name: 'Vex123' });

    expect(await screen.findByText('Step 13 of 13')).toBeTruthy();
    const input = screen.getByLabelText(/name:/i) as HTMLInputElement;
    expect(input.value).toBe('Vex123');

    // Blurring surfaces the shared name rule inline.
    fireEvent.blur(input);
    expect(await screen.findByRole('alert')).toHaveTextContent('can only contain letters');

    // The save gate still refuses the invalid name.
    fireEvent.click(screen.getByText('Complete Character'));
    await waitFor(() => {
      expect(harness.toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Critical Fields Missing' }),
      );
    });
    expect(harness.saveCharacter).not.toHaveBeenCalled();

    // Correcting the name in place unblocks completion.
    fireEvent.change(input, { target: { value: 'Vex Marlowe' } });
    fireEvent.click(screen.getByText('Complete Character'));
    await waitFor(() => {
      expect(harness.saveCharacter).toHaveBeenCalledTimes(1);
    });
    expect(harness.saveCharacter.mock.calls[0]?.[0]).toMatchObject({ name: 'Vex Marlowe' });
  });

  it('shows the saved name as plain text when the character already has one', async () => {
    renderAtFinalStep({ ...namelessRogue(), name: 'Vex Marlowe' });

    expect(await screen.findByText('Step 13 of 13')).toBeTruthy();
    // The name renders in the summary (and the preview sidebar).
    expect(screen.getAllByText('Vex Marlowe').length).toBeGreaterThan(0);
    expect(screen.queryByLabelText(/name:/i)).toBeNull();
  });
});
