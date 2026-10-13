import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import FeaturesTab from '../FeaturesTab';

import type { Character } from '@/types/character';

vi.mock('@/services/class-features-api', () => ({
  getCharacterClassFeatures: vi.fn().mockResolvedValue({ features: [], usesRemaining: {} }),
}));

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

const renderTab = (character: Character): ReturnType<typeof render> => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <FeaturesTab character={character} onUpdate={async () => true} />
    </QueryClientProvider>,
  );
};

describe('FeaturesTab racial traits (#389)', () => {
  it('lists the subrace trait alongside the race traits', () => {
    renderTab(buildCharacter());

    // Each trait renders as a title + description pair.
    expect(screen.getAllByText('Darkvision').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Dwarven Resilience').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Dwarven Toughness').length).toBeGreaterThan(0);
  });

  it('dedupes a trait present on both race and subrace', () => {
    renderTab(
      buildCharacter({
        subrace: {
          id: 'hill-dwarf',
          name: 'Hill Dwarf',
          traits: ['Dwarven Toughness', 'Darkvision'],
        } as unknown as Character['subrace'],
      }),
    );

    // One feature card for Darkvision (title + description = 2 nodes), not two cards.
    expect(screen.getAllByText('Darkvision')).toHaveLength(2);
  });

  it('renders with no subrace', () => {
    renderTab(buildCharacter({ subrace: null }));

    expect(screen.getAllByText('Darkvision').length).toBeGreaterThan(0);
    expect(screen.queryByText('Dwarven Toughness')).not.toBeInTheDocument();
  });
});
