import { render, screen, within, waitFor } from '@testing-library/react';
import React, { useEffect } from 'react';
import { describe, it, expect, vi } from 'vitest';

import CharacterPreview from '../CharacterPreview';
import { CharacterPreviewAbilityScores } from '../CharacterPreviewAbilityScores';

import type { Character } from '@/types/character';

import { CharacterProvider, useCharacter } from '@/contexts/CharacterContext';
import { fighter } from '@/data/classes/fighter';
import { dwarf } from '@/data/races/dwarf';

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// #389: the creation summary must show post-racial ability scores, not the
// base scores the wizard holds. Fixture follows the wizard's Character shape:
// race/subrace as objects with abilityScoreIncrease, abilityScores as base.
const buildCharacter = (overrides: Partial<Character> = {}): Character =>
  ({
    id: 'char-1',
    name: 'Test Dwarf',
    race: {
      id: 'dwarf',
      name: 'Dwarf',
      abilityScoreIncrease: { constitution: 2 },
      traits: ['Darkvision', 'Dwarven Resilience'],
    },
    subrace: {
      id: 'hill-dwarf',
      name: 'Hill Dwarf',
      abilityScoreIncrease: { wisdom: 1 },
      traits: ['Dwarven Toughness'],
    },
    abilityScores: {
      strength: { score: 15, modifier: 2, savingThrow: false },
      dexterity: { score: 14, modifier: 2, savingThrow: false },
      constitution: { score: 13, modifier: 1, savingThrow: false },
      intelligence: { score: 12, modifier: 1, savingThrow: false },
      wisdom: { score: 10, modifier: 0, savingThrow: false },
      charisma: { score: 8, modifier: -1, savingThrow: false },
    },
    ...overrides,
  }) as Character;

/** The ability row (score + modifier cell) for a named ability. */
const rowFor = (abilityName: string): HTMLElement => {
  const label = screen.getByText(abilityName);
  const row = label.closest('div.flex.items-center.justify-between');
  if (!row) throw new Error(`ability row missing for ${abilityName}`);
  return row as HTMLElement;
};

describe('CharacterPreviewAbilityScores (#389)', () => {
  it('shows post-racial scores for a Hill Dwarf (CON +2, WIS +1)', () => {
    render(<CharacterPreviewAbilityScores character={buildCharacter()} />);

    // CON 13 + 2 = 15 (+2). Scoped to the CON row: the bare '15' assertion
    // also matched STR 15, and the base 13 must not appear in this row.
    const conRow = rowFor('constitution');
    expect(within(conRow).getByText('15')).toBeInTheDocument();
    expect(within(conRow).getByText('+2')).toBeInTheDocument();
    expect(within(conRow).queryByText('13')).not.toBeInTheDocument();

    // WIS 10 + 1 = 11 (+0); base 10 absent from the WIS row.
    const wisRow = rowFor('wisdom');
    expect(within(wisRow).getByText('11')).toBeInTheDocument();
    expect(within(wisRow).getByText('+0')).toBeInTheDocument();
    expect(within(wisRow).queryByText('10')).not.toBeInTheDocument();
  });

  it('shows base scores when no race is selected', () => {
    render(
      <CharacterPreviewAbilityScores character={buildCharacter({ race: null, subrace: null })} />,
    );

    // CON stays 13, WIS stays 10.
    expect(screen.getByText('13', { selector: 'div.font-bold' })).toBeInTheDocument();
    expect(screen.getByText('10', { selector: 'div.font-bold' })).toBeInTheDocument();
  });
});

const hillDwarf = dwarf.subraces?.find((s) => s.id === 'hill-dwarf');

/**
 * #389 item 2: render the real CharacterPreview inside CharacterProvider with
 * the real dwarf / Hill Dwarf / fighter data (pattern from #429's
 * AbilityScoresSelection test), not a hand-made Character.
 */
function SeedPreview(): React.ReactElement {
  const { dispatch } = useCharacter();

  useEffect(() => {
    dispatch({
      type: 'SET_CHARACTER',
      payload: {
        name: 'Hill Dwarf Fighter',
        race: dwarf,
        subrace: hillDwarf,
        class: fighter,
        level: 5,
        abilityScores: {
          strength: { score: 15, modifier: 2, savingThrow: false },
          dexterity: { score: 14, modifier: 2, savingThrow: false },
          constitution: { score: 13, modifier: 1, savingThrow: false },
          intelligence: { score: 12, modifier: 1, savingThrow: false },
          wisdom: { score: 10, modifier: 0, savingThrow: false },
          charisma: { score: 8, modifier: -1, savingThrow: false },
        },
      },
    });
  }, [dispatch]);

  return <CharacterPreview />;
}

describe('CharacterPreview in provider (#389)', () => {
  it('shows post-racial scores from the real dwarf / Hill Dwarf / fighter data', async () => {
    render(
      <CharacterProvider>
        <SeedPreview />
      </CharacterProvider>,
    );

    await waitFor(() => {
      // Header proves the real data is in the provider.
      expect(screen.getByText('Hill Dwarf Fighter')).toBeInTheDocument();
      expect(screen.getByText('Hill Dwarf (Dwarf)')).toBeInTheDocument();
    });

    // CON 13 + 2 = 15 (+2) in the CON row; base 13 absent.
    const conRow = rowFor('constitution');
    expect(within(conRow).getByText('15')).toBeInTheDocument();
    expect(within(conRow).getByText('+2')).toBeInTheDocument();
    expect(within(conRow).queryByText('13')).not.toBeInTheDocument();

    // WIS 10 + 1 = 11 (+0) in the WIS row; base 10 absent.
    const wisRow = rowFor('wisdom');
    expect(within(wisRow).getByText('11')).toBeInTheDocument();
    expect(within(wisRow).getByText('+0')).toBeInTheDocument();
    expect(within(wisRow).queryByText('10')).not.toBeInTheDocument();

    // Level 5 uses the shared 2014 proficiency boundary (+3).
    expect(screen.getByText('+3')).toBeInTheDocument();
  });
});
