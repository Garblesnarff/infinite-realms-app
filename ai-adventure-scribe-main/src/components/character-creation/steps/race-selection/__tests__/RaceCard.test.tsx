import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { RaceCardListView, RaceCardCompactView, RaceCardGridView } from '../RaceCard';

// Wrap tests in TooltipProvider to ensure Tooltips are active
import type { CharacterRace } from '@/types/character';

import { TooltipProvider } from '@/components/ui/tooltip';

describe('RaceCard Components', () => {
  const mockRace = {
    id: 'elf',
    name: 'Elf',
    description: 'Elves are a magical people of otherworldly grace.',
    speed: 30,
    languages: ['Common', 'Elvish'],
    abilityScoreIncrease: {
      Dexterity: 2,
      Intelligence: 1,
    } as Record<string, number>,
    subraces: [
      { id: 'high-elf', name: 'High Elf' }
    ] as unknown as CharacterRace['subraces'],
  };

  const defaultProps = {
    race: mockRace as unknown as CharacterRace,
    isSelected: false,
    isFavorite: false,
    onSelect: vi.fn(),
    onToggleFavorite: vi.fn(),
    onAddToComparison: vi.fn(),
    canAddToComparison: true,
  };

  it('RaceCardListView renders attributes and custom Tooltips correctly', () => {
    render(
      <TooltipProvider>
        <RaceCardListView {...defaultProps} />
      </TooltipProvider>
    );

    // Verify race name and description
    expect(screen.getByText('Elf')).toBeInTheDocument();
    expect(screen.getByText(mockRace.description)).toBeInTheDocument();

    // Verify the favorite button exists
    const favoriteBtn = screen.getByRole('button', { name: /add to favorites/i });
    expect(favoriteBtn).toBeInTheDocument();

    // Verify comparison button exists and is enabled
    const comparisonBtn = screen.getByRole('button', { name: /add to comparison/i });
    expect(comparisonBtn).toBeInTheDocument();
    expect(comparisonBtn).not.toBeDisabled();

    // Verify ability score badges are keyboard-focusable
    const dexBadge = screen.getByLabelText(/dexterity increase of 2/i);
    const intBadge = screen.getByLabelText(/intelligence increase of 1/i);
    expect(dexBadge).toBeInTheDocument();
    expect(dexBadge).toHaveAttribute('tabIndex', '0');
    expect(intBadge).toBeInTheDocument();
    expect(intBadge).toHaveAttribute('tabIndex', '0');
  });

  it('RaceCardListView handles conditionally disabled comparison button with pointer-events-none inside cursor-not-allowed span wrapper', () => {
    render(
      <TooltipProvider>
        <RaceCardListView {...defaultProps} canAddToComparison={false} />
      </TooltipProvider>
    );

    const comparisonBtn = screen.getByRole('button', { name: /add to comparison/i });
    expect(comparisonBtn).toBeDisabled();
    expect(comparisonBtn).toHaveClass('pointer-events-none');

    // Verify the wrapper span has cursor-not-allowed
    const wrapperSpan = comparisonBtn.closest('span');
    expect(wrapperSpan).toHaveClass('cursor-not-allowed');
  });

  it('RaceCardCompactView renders attributes and badges correctly', () => {
    render(
      <TooltipProvider>
        <RaceCardCompactView {...defaultProps} />
      </TooltipProvider>
    );

    expect(screen.getByText('Elf')).toBeInTheDocument();

    // Verify ability score badges are keyboard-focusable
    const dexBadge = screen.getByLabelText(/dexterity increase of 2/i);
    expect(dexBadge).toBeInTheDocument();
    expect(dexBadge).toHaveAttribute('tabIndex', '0');
  });

  it('RaceCardGridView renders attributes, buttons, and custom Tooltips correctly', () => {
    render(
      <TooltipProvider>
        <RaceCardGridView {...defaultProps} isFavorite={true} />
      </TooltipProvider>
    );

    expect(screen.getByText('Elf')).toBeInTheDocument();

    // Verify favorite button is pressed
    const favoriteBtn = screen.getByRole('button', { name: /remove from favorites/i });
    expect(favoriteBtn).toBeInTheDocument();
    expect(favoriteBtn).toHaveAttribute('aria-pressed', 'true');

    // Verify ability score badges are keyboard-focusable
    const intBadge = screen.getByLabelText(/intelligence increase of 1/i);
    expect(intBadge).toBeInTheDocument();
    expect(intBadge).toHaveAttribute('tabIndex', '0');
  });
});
