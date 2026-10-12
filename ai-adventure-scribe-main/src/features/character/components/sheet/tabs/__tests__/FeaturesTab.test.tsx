import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import FeaturesTab from '../FeaturesTab';

import type { Character } from '@/types/character';

// #389: subrace traits (Hill Dwarf's Dwarven Toughness) must appear in the
// Racial Traits section, not just the base race's traits. Fixture follows the
// loader's Character shape (data-transformers.ts): race and subrace resolved
// to objects with traits arrays.
const buildCharacter = (overrides: Partial<Character> = {}): Character =>
  ({
    id: 'char-1',
    name: 'Test Cleric',
    level: 1,
    race: {
      id: 'dwarf',
      name: 'Dwarf',
      traits: ['Darkvision', 'Dwarven Resilience'],
    },
    subrace: {
      id: 'hill-dwarf',
      name: 'Hill Dwarf',
      traits: ['Dwarven Toughness'],
    },
    class: { id: 'cleric', name: 'Cleric' },
    ...overrides,
  }) as Character;

describe('FeaturesTab racial traits (#389)', () => {
  it('lists the subrace trait alongside the race traits', () => {
    render(<FeaturesTab character={buildCharacter()} onUpdate={async () => true} />);

    // Each trait renders as a title + description pair.
    expect(screen.getAllByText('Darkvision').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Dwarven Resilience').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Dwarven Toughness').length).toBeGreaterThan(0);
  });

  it('dedupes a trait present on both race and subrace', () => {
    render(
      <FeaturesTab
        character={buildCharacter({
          subrace: {
            id: 'hill-dwarf',
            name: 'Hill Dwarf',
            traits: ['Dwarven Toughness', 'Darkvision'],
          } as unknown as Character['subrace'],
        })}
        onUpdate={async () => true}
      />,
    );

    // One feature card for Darkvision (title + description = 2 nodes), not two cards.
    expect(screen.getAllByText('Darkvision')).toHaveLength(2);
  });

  it('renders with no subrace', () => {
    render(
      <FeaturesTab
        character={buildCharacter({ subrace: null })}
        onUpdate={async () => true}
      />,
    );

    expect(screen.getAllByText('Darkvision').length).toBeGreaterThan(0);
    expect(screen.queryByText('Dwarven Toughness')).not.toBeInTheDocument();
  });
});
