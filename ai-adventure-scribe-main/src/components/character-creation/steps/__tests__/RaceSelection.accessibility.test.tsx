import { render, screen } from '@testing-library/react';
import React from 'react';
import { vi, describe, it, expect } from 'vitest';

import { useRaceSelection } from '../race-selection/use-race-selection';
import RaceSelection from '../RaceSelection';

// Mock the hook
vi.mock('../race-selection/use-race-selection', () => ({
  useRaceSelection: vi.fn(),
}));

// Mock the components used in RaceSelection
vi.mock('../race-selection/RaceCard', () => ({
  RaceCardListView: () => <div data-testid="race-card-list" />,
  RaceCardCompactView: () => <div data-testid="race-card-compact" />,
  RaceCardGridView: () => <div data-testid="race-card-grid" />,
}));
vi.mock('../race-selection/SubraceCard', () => ({
  SubraceCard: () => <div data-testid="subrace-card" />,
}));
vi.mock('../../modals/HalfElfAbilityChoice', () => ({
  HalfElfAbilityChoice: () => <div data-testid="half-elf-modal" />,
}));
vi.mock('../../modals/VariantHumanChoice', () => ({
  VariantHumanChoice: () => <div data-testid="variant-human-modal" />,
}));

describe('RaceSelection Accessibility', () => {
  it('should have a group role and aria-label for category filters', () => {
    (useRaceSelection as any).mockReturnValue({
      state: { character: {} },
      raceCategories: [
        { id: 'all', name: 'All', count: 10 },
        { id: 'common', name: 'Common', count: 5 },
      ],
      filteredRaces: [],
      selectedCategory: 'all',
      favorites: new Set(),
      comparisonRaces: [],
      viewMode: 'grid',
      showSubraces: false,
      setSearchQuery: vi.fn(),
      setSelectedCategory: vi.fn(),
      setViewMode: vi.fn(),
    });

    render(<RaceSelection />);

    const group = screen.getByRole('group', { name: /filter races by category/i });
    expect(group).toBeInTheDocument();
  });

  it('should have aria-pressed set correctly on category buttons', () => {
    (useRaceSelection as any).mockReturnValue({
      state: { character: {} },
      raceCategories: [
        { id: 'all', name: 'All', count: 10 },
        { id: 'common', name: 'Common', count: 5 },
      ],
      filteredRaces: [],
      selectedCategory: 'common',
      favorites: new Set(),
      comparisonRaces: [],
      viewMode: 'grid',
      showSubraces: false,
      setSearchQuery: vi.fn(),
      setSelectedCategory: vi.fn(),
      setViewMode: vi.fn(),
    });

    render(<RaceSelection />);

    const allButton = screen.getByRole('button', { name: /all \(10\)/i });
    const commonButton = screen.getByRole('button', { name: /common \(5\)/i });

    expect(allButton).toHaveAttribute('aria-pressed', 'false');
    expect(commonButton).toHaveAttribute('aria-pressed', 'true');
  });
});
