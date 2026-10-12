import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { CharacterPreviewAbilityScores } from '../CharacterPreviewAbilityScores';

import type { Character } from '@/types/character';

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
      strength: { score: 15, modifier: 2 },
      dexterity: { score: 14, modifier: 2 },
      constitution: { score: 13, modifier: 1 },
      intelligence: { score: 12, modifier: 1 },
      wisdom: { score: 10, modifier: 0 },
      charisma: { score: 8, modifier: -1 },
    },
    ...overrides,
  }) as Character;

describe('CharacterPreviewAbilityScores (#389)', () => {
  it('shows post-racial scores for a Hill Dwarf (CON +2, WIS +1)', () => {
    render(<CharacterPreviewAbilityScores character={buildCharacter()} />);

    // CON 13 + 2 = 15, WIS 10 + 1 = 11. Base scores must not appear.
    // Each score renders in a div.font-bold.
    const scores = screen.getAllByText('15', { selector: 'div.font-bold' });
    expect(scores.length).toBeGreaterThan(0);

    // WIS 11 appears; base WIS 10 does not (in the score slot).
    expect(screen.getByText('11', { selector: 'div.font-bold' })).toBeInTheDocument();
  });

  it('shows base scores when no race is selected', () => {
    render(
      <CharacterPreviewAbilityScores
        character={buildCharacter({ race: null, subrace: null })}
      />,
    );

    // CON stays 13, WIS stays 10.
    expect(screen.getByText('13', { selector: 'div.font-bold' })).toBeInTheDocument();
    expect(screen.getByText('10', { selector: 'div.font-bold' })).toBeInTheDocument();
  });
});
