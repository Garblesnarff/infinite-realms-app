import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { useEffect, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import AbilityScoresSelection from '../AbilityScoresSelection';

import { CharacterProvider, useCharacter } from '@/contexts/CharacterContext';
import { fighter } from '@/data/classes/fighter';
import { dwarf } from '@/data/races/dwarf';

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const rolledScores = {
  abilityScores: {
    strength: { score: 17, modifier: 3, savingThrow: false },
    dexterity: { score: 14, modifier: 2, savingThrow: false },
    constitution: { score: 13, modifier: 1, savingThrow: false },
    intelligence: { score: 12, modifier: 1, savingThrow: false },
    wisdom: { score: 10, modifier: 0, savingThrow: false },
    charisma: { score: 9, modifier: -1, savingThrow: false },
  },
  class: fighter,
  race: dwarf,
  level: 1,
  abilityScoreMethod: 'roll',
};

function Seed(): React.ReactElement | null {
  const { state, dispatch } = useCharacter();
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    dispatch({ type: 'SET_CHARACTER', payload: rolledScores as never });
    setSeeded(true);
  }, [dispatch]);

  if (!seeded || !state.character) return null;
  return <AbilityScoresSelection />;
}

function renderRollTab(): void {
  render(
    <CharacterProvider>
      <Seed />
    </CharacterProvider>,
  );
}

describe('ability-score Reset asks for confirmation (#213)', () => {
  it('does not clear the scores on the first click; asks first', async () => {
    renderRollTab();
    await waitFor(() =>
      expect(screen.getByLabelText('Final strength score: 17')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reset ability scores' }));

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('Reset ability scores?')).toBeInTheDocument();
    expect(screen.getByLabelText('Final strength score: 17')).toBeInTheDocument();
  });

  it('keeps the rolled scores when the player cancels', async () => {
    renderRollTab();
    await waitFor(() =>
      expect(screen.getByLabelText('Final strength score: 17')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reset ability scores' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Keep scores' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Final strength score: 17')).toBeInTheDocument();
  });

  it('clears the scores to 8 only after the player confirms', async () => {
    renderRollTab();
    await waitFor(() =>
      expect(screen.getByLabelText('Final strength score: 17')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reset ability scores' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Reset scores' }));

    await waitFor(() =>
      expect(screen.getByLabelText('Final strength score: 8')).toBeInTheDocument(),
    );
  });
});
