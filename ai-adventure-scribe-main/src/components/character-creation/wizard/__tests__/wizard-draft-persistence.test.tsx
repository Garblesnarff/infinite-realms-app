import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { Character } from '@/types/character';

import {
  WIZARD_DRAFT_VERSION,
  getWizardDraftKey,
  writeWizardDraft,
} from '@/components/character-creation/wizard/wizard-draft';
import WizardContent from '@/components/character-creation/wizard/WizardContent';

const mockState = vi.hoisted(() => ({
  character: null as unknown as Character | null,
  dispatch: vi.fn(),
  toast: vi.fn(),
}));

// Three stub steps; unknown labels pass validation (validateStep defaults VALID).
// Step B is skipped for a named character, exercising the filtered-step path.
vi.mock('@/components/character-creation/wizard/constants', () => ({
  wizardSteps: [
    { component: () => <div data-testid="step-a">Step A</div>, label: 'Step A' },
    {
      component: () => <div data-testid="step-b">Step B</div>,
      label: 'Step B',
      skipCondition: (character: Character | null) => !!character?.name,
    },
    { component: () => <div data-testid="step-c">Step C</div>, label: 'Step C' },
  ],
}));

vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => ({
    state: { character: mockState.character },
    dispatch: mockState.dispatch,
  }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('@/hooks/use-character-save', () => ({
  useCharacterSave: () => ({ saveCharacter: async () => null, isSaving: false }),
}));

vi.mock('@/hooks/use-auto-scroll', () => ({ useAutoScroll: () => ({ scrollToTop: () => {} }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mockState.toast }) }));

function LocationProbe(): React.JSX.Element {
  const location = useLocation();
  return (
    <div data-testid="location-search">
      {location.pathname}
      {location.search}
    </div>
  );
}

function renderWizard(initialEntries: string[] = ['/wizard']): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <LocationProbe />
      <WizardContent />
    </MemoryRouter>,
  );
}

const DRAFT_KEY = getWizardDraftKey('user-1');

describe('wizard draft persistence (#208)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockState.character = null;
    mockState.dispatch.mockClear();
  });

  it('restores a stored draft on refresh when the user chooses Resume', async () => {
    const draftCharacter = { name: 'Draft Hero' } as Character;
    writeWizardDraft(DRAFT_KEY, {
      version: WIZARD_DRAFT_VERSION,
      character: draftCharacter,
      step: 2,
      campaignId: null,
      updatedAt: new Date().toISOString(),
    });

    renderWizard();

    // Resume is offered, not applied silently.
    expect(await screen.findByText('Resume your character?')).toBeTruthy();
    expect(mockState.dispatch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Resume draft'));

    expect(mockState.dispatch).toHaveBeenCalledWith({
      type: 'SET_CHARACTER',
      payload: draftCharacter,
    });
    // The restored step lands in the URL and renders the matching step.
    await waitFor(() => {
      expect(screen.getByTestId('location-search').textContent).toContain('step=2');
    });
  });

  it('discards the draft when the user chooses Start over', async () => {
    writeWizardDraft(DRAFT_KEY, {
      version: WIZARD_DRAFT_VERSION,
      character: { name: 'Draft Hero' } as Character,
      step: 2,
      campaignId: null,
      updatedAt: new Date().toISOString(),
    });

    renderWizard();
    expect(await screen.findByText('Resume your character?')).toBeTruthy();

    fireEvent.click(screen.getByText('Start over'));

    await waitFor(() => {
      expect(screen.queryByText('Resume your character?')).toBeNull();
    });
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
    // "Start over" resets the form to a pristine character so the discarded
    // draft cannot resurrect on the next edit.
    expect(mockState.dispatch).toHaveBeenCalledWith({
      type: 'SET_CHARACTER',
      payload: expect.objectContaining({ name: '', race: null, class: null }),
    });
  });

  it('moves the step into the URL on Next, and reads the step back from the URL', async () => {
    mockState.character = {} as Character;
    renderWizard();

    expect(screen.getByTestId('step-a')).toBeTruthy();
    fireEvent.click(screen.getByText('Continue'));

    await waitFor(() => {
      expect(screen.getByTestId('location-search').textContent).toContain('step=1');
    });
    expect(screen.getByTestId('step-b')).toBeTruthy();
  });

  it('passes the filtered step list to the progress track (no phantom steps)', () => {
    // Step B is skipped for a named character: the track must show A and C only.
    mockState.character = { name: 'Test Hero' } as Character;
    renderWizard();

    expect(screen.getByText('Step C')).toBeTruthy();
    expect(screen.queryByText('Step B')).toBeNull();
  });

  it('starts on the step named by the URL (what browser Back produces)', () => {
    renderWizard(['/wizard?step=2']);
    expect(screen.getByTestId('step-c')).toBeTruthy();
  });

  it('warns on beforeunload while the draft has data', () => {
    mockState.character = { name: 'Half-typed Hero' } as Character;
    renderWizard();

    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not warn on beforeunload with a pristine wizard', () => {
    renderWizard();

    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('Cancel asks for confirmation, then clears the draft and leaves', async () => {
    mockState.character = { name: 'Half-typed Hero' } as Character;

    renderWizard();

    fireEvent.click(screen.getByText('Cancel'));
    expect(await screen.findByText('Cancel character creation?')).toBeTruthy();

    fireEvent.click(screen.getByText('Discard draft'));

    await waitFor(() => {
      expect(screen.getByTestId('location-search').textContent).toContain('/app/characters');
    });
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
  });
});
