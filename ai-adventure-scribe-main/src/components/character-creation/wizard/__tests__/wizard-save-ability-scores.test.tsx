import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { Character } from '@/types/character';

import WizardContent from '@/components/character-creation/wizard/WizardContent';
import { backgrounds } from '@/data/backgroundOptions';
import { classes } from '@/data/classes';
import { dwarf } from '@/data/races/dwarf';

const mockState = vi.hoisted(() => ({
  character: null as unknown as Character | null,
  dispatch: vi.fn(),
  toast: vi.fn(),
  saveCharacter: vi.fn(async () => ({ id: 'saved-1' })),
}));

vi.mock('@/components/character-creation/wizard/constants', () => ({
  wizardSteps: [{ component: () => <div>Review</div>, label: 'Review' }],
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
  useCharacterSave: () => ({ saveCharacter: mockState.saveCharacter, isSaving: false }),
}));

vi.mock('@/hooks/use-auto-scroll', () => ({ useAutoScroll: () => ({ scrollToTop: () => {} }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mockState.toast }) }));

const hillDwarf = dwarf.subraces?.find((subrace) => subrace.id === 'hill-dwarf');
const fighter = classes.find((characterClass) => characterClass.id === 'fighter');
const acolyte = backgrounds.find((background) => background.id === 'acolyte');

if (!hillDwarf || !fighter || !acolyte) {
  throw new Error('Hill Dwarf, Fighter, or Acolyte is missing from the real producers');
}

function score(value: number): { score: number; modifier: number; savingThrow: boolean } {
  return { score: value, modifier: 0, savingThrow: false };
}

function characterWithScores(values: number[], method: 'pointBuy' | undefined): Character {
  const [strength, dexterity, constitution, intelligence, wisdom, charisma] = values;
  return {
    name: 'Hilda',
    race: dwarf,
    subrace: hillDwarf,
    class: fighter,
    background: acolyte,
    ...(method ? { abilityScoreMethod: method } : {}),
    abilityScores: {
      strength: score(strength),
      dexterity: score(dexterity),
      constitution: score(constitution),
      intelligence: score(intelligence),
      wisdom: score(wisdom),
      charisma: score(charisma),
    },
  } as Character;
}

function renderWizard(): void {
  render(
    <MemoryRouter initialEntries={['/wizard']}>
      <WizardContent />
    </MemoryRouter>,
  );
}

describe('wizard save ability-score gate (#213)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockState.dispatch.mockClear();
    mockState.toast.mockClear();
    mockState.saveCharacter.mockClear();
  });

  it('does not save an over-budget point-buy sheet', async () => {
    mockState.character = characterWithScores([15, 15, 15, 9, 8, 8], 'pointBuy');
    renderWizard();

    fireEvent.click(screen.getByText('Complete Character'));

    await waitFor(() => {
      expect(mockState.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Critical Fields Missing',
          description: expect.stringContaining('ability scores'),
        }),
      );
    });
    expect(mockState.saveCharacter).not.toHaveBeenCalled();
  });

  it('saves a legal point-buy sheet from the same final step', async () => {
    mockState.character = characterWithScores([15, 15, 15, 8, 8, 8], 'pointBuy');
    renderWizard();

    fireEvent.click(screen.getByText('Complete Character'));

    await waitFor(() => {
      expect(mockState.saveCharacter).toHaveBeenCalledTimes(1);
    });
  });

  it('saves a pre-method draft whose stored scores are over the point-buy budget', async () => {
    mockState.character = characterWithScores([15, 15, 15, 9, 8, 8], undefined);
    renderWizard();

    fireEvent.click(screen.getByText('Complete Character'));

    await waitFor(() => {
      expect(mockState.saveCharacter).toHaveBeenCalledTimes(1);
    });
  });
});
