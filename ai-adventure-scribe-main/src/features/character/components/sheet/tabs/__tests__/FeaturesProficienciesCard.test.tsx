import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { FeaturesProficienciesCard } from '../FeaturesProficienciesCard';

import type { Character } from '@/types/character';

// #214 (QA-052): the card renders the character's real proficiencies, never
// static placeholders. Fixture follows the loader's Character shape
// (data-transformers.ts): class resolved with armor/weapon proficiencies,
// languages and toolProficiencies from the stored record.
const buildCharacter = (overrides: Partial<Character> = {}): Character =>
  ({
    id: 'char-1',
    name: 'Test Fighter',
    class: {
      id: 'fighter',
      name: 'Fighter',
      armorProficiencies: ['All armor', 'Shields'],
      weaponProficiencies: ['Simple weapons', 'Martial weapons'],
    },
    languages: ['Common', 'Dwarvish'],
    toolProficiencies: ["Thieves' Tools"],
    ...overrides,
  }) as Character;

describe('FeaturesProficienciesCard', () => {
  it("renders the character's languages instead of the static Common/Elvish", () => {
    render(<FeaturesProficienciesCard character={buildCharacter()} />);

    expect(screen.getByText('Dwarvish')).toBeInTheDocument();
    expect(screen.queryByText('Elvish')).not.toBeInTheDocument();
  });

  it("renders the character's tool proficiencies instead of Smith's Tools", () => {
    render(<FeaturesProficienciesCard character={buildCharacter()} />);

    expect(screen.getByText("Thieves' Tools")).toBeInTheDocument();
    expect(screen.queryByText("Smith's Tools")).not.toBeInTheDocument();
  });

  it('renders the class armor and weapon proficiencies', () => {
    render(<FeaturesProficienciesCard character={buildCharacter()} />);

    expect(screen.getByText('All armor')).toBeInTheDocument();
    expect(screen.getByText('Martial weapons')).toBeInTheDocument();
  });

  it('shows None for empty sections rather than placeholders', () => {
    render(
      <FeaturesProficienciesCard
        character={buildCharacter({ languages: [], toolProficiencies: [] })}
      />,
    );

    expect(screen.getAllByText('None').length).toBeGreaterThan(0);
    expect(screen.queryByText("Smith's Tools")).not.toBeInTheDocument();
  });
});
