import { render, screen, waitFor } from '@testing-library/react';
import React, { useEffect, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import AbilityScoresSelection from '../AbilityScoresSelection';

import { CharacterProvider, useCharacter } from '@/contexts/CharacterContext';
import { classes } from '@/data/classes';
import { fighter } from '@/data/classes/fighter';
import { dwarf } from '@/data/races/dwarf';

const hillDwarf = dwarf.subraces?.find((subrace) => subrace.id === 'hill-dwarf');
let selectedClass = fighter;

const character = {
  abilityScores: {
    strength: { score: 10, modifier: 0, savingThrow: false },
    dexterity: { score: 10, modifier: 0, savingThrow: false },
    constitution: { score: 13, modifier: 1, savingThrow: false },
    intelligence: { score: 10, modifier: 0, savingThrow: false },
    wisdom: { score: 10, modifier: 0, savingThrow: false },
    charisma: { score: 10, modifier: 0, savingThrow: false },
  },
  class: fighter,
  race: dwarf,
  subrace: hillDwarf,
  level: 1,
};

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

function SeedCharacter(): React.ReactElement {
  const { dispatch } = useCharacter();

  useEffect(() => {
    dispatch({
      type: 'SET_CHARACTER',
      payload: { ...character, class: selectedClass },
    });
  }, [dispatch]);

  return <AbilityScoresSelection />;
}

function renderAbilityScoresStep(): ReturnType<typeof render> {
  return render(
    <CharacterProvider>
      <SeedCharacter />
    </CharacterProvider>,
  );
}

function SeedStoredMethod(): React.ReactElement | null {
  const { state, dispatch } = useCharacter();
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    dispatch({
      type: 'SET_CHARACTER',
      payload: { ...character, class: fighter, abilityScoreMethod: 'roll' },
    });
    setSeeded(true);
  }, [dispatch]);

  if (!seeded || state.character?.abilityScoreMethod !== 'roll') return null;
  return <AbilityScoresSelection />;
}

describe('AbilityScoresSelection wizard step (#213)', () => {
  it('shows racial bonuses, final modifiers, point-buy totals, and level-one HP', () => {
    renderAbilityScoresStep();

    return waitFor(() => {
      expect(screen.getByText('12 points left')).toBeInTheDocument();
      expect(screen.getByLabelText('+2 racial bonus to constitution')).toBeInTheDocument();
      expect(screen.getByLabelText('Final constitution score: 15')).toBeInTheDocument();
      expect(screen.getByLabelText('Final wisdom score: 11')).toBeInTheDocument();
      expect(screen.getByText('Total modifier bonus: +2')).toBeInTheDocument();
      expect(screen.getByText('Level 1 hit points: 13')).toBeInTheDocument();
      expect(screen.getByText('66 total')).toBeInTheDocument();
    });
  });

  it.each(classes)('calculates level-one hit points for %s', async (characterClass) => {
    selectedClass = characterClass;

    renderAbilityScoresStep();

    await waitFor(() => {
      expect(
        screen.getByText(`Level 1 hit points: ${characterClass.hitDie + 3}`),
      ).toBeInTheDocument();
    });
  });

  it('shows the Roll tab when the stored method is roll', async () => {
    render(
      <CharacterProvider>
        <SeedStoredMethod />
      </CharacterProvider>,
    );

    const rollTab = await screen.findByRole('tab', { name: 'Roll Scores' });
    expect(rollTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Point Buy' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });
});
