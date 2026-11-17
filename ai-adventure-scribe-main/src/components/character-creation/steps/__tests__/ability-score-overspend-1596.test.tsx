import { render, screen, waitFor } from '@testing-library/react';
import React, { useEffect, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import AbilityScoresSelection from '../AbilityScoresSelection';

import { CharacterProvider, useCharacter } from '@/contexts/CharacterContext';
import { fighter } from '@/data/classes/fighter';
import { dwarf } from '@/data/races/dwarf';

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const every = (score: number, mod: number) => ({ score, modifier: mod, savingThrow: false });

// Six 15s cost 54 points, 27 over the budget, so remaining points are -27.
const overspent = {
  abilityScores: {
    strength: every(15, 2),
    dexterity: every(15, 2),
    constitution: every(15, 2),
    intelligence: every(15, 2),
    wisdom: every(15, 2),
    charisma: every(15, 2),
  },
  class: fighter,
  race: dwarf,
  level: 1,
  abilityScoreMethod: 'pointBuy',
};

function Seed(): React.ReactElement | null {
  const { state, dispatch } = useCharacter();
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    dispatch({ type: 'SET_CHARACTER', payload: overspent as never });
    setSeeded(true);
  }, [dispatch]);
  if (!seeded || !state.character) return null;
  return <AbilityScoresSelection />;
}

describe('Point Buy overspend says why Continue is blocked (#1596)', () => {
  it('shows one line next to the points total that names the overspend', async () => {
    render(
      <CharacterProvider>
        <Seed />
      </CharacterProvider>,
    );

    await waitFor(() => expect(screen.getByText(/Points Remaining/)).toBeInTheDocument());
    expect(screen.getByText(/Over budget by 27 points/)).toBeInTheDocument();
  });

  it('shows no overspend line when the budget is not exceeded', async () => {
    const withinBudget = {
      ...overspent,
      abilityScores: {
        strength: every(8, -1),
        dexterity: every(8, -1),
        constitution: every(8, -1),
        intelligence: every(8, -1),
        wisdom: every(8, -1),
        charisma: every(8, -1),
      },
    };
    const Within = (): React.ReactElement | null => {
      const { state, dispatch } = useCharacter();
      const [seeded, setSeeded] = useState(false);
      useEffect(() => {
        dispatch({ type: 'SET_CHARACTER', payload: withinBudget as never });
        setSeeded(true);
      }, [dispatch]);
      if (!seeded || !state.character) return null;
      return <AbilityScoresSelection />;
    };
    render(
      <CharacterProvider>
        <Within />
      </CharacterProvider>,
    );

    await waitFor(() => expect(screen.getByText(/Points Remaining/)).toBeInTheDocument());
    expect(screen.queryByText(/Over budget by/)).not.toBeInTheDocument();
  });
});
