import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { vi, describe, it, expect } from 'vitest';

import AbilityScoreCard from '../AbilityScoreCard';

import type { Method } from '@/hooks/use-ability-score-selection';
import type { AbilityScores } from '@/types/character';

import { TooltipProvider } from '@/components/ui/tooltip';

describe('AbilityScoreCard', () => {
  const defaultProps = {
    ability: 'strength' as keyof AbilityScores,
    baseScore: 10,
    racialBonus: 2,
    finalScore: 12,
    modifier: 1,
    description: 'Strength measures bodily power.',
    method: 'pointBuy' as Method,
    remainingPoints: 27,
    nextCost: 1,
    onIncrease: vi.fn(),
    onDecrease: vi.fn(),
  };

  const renderWithProvider = (props = defaultProps): ReturnType<typeof render> => {
    return render(
      <TooltipProvider delayDuration={0}>
        <AbilityScoreCard {...props} />
      </TooltipProvider>,
    );
  };

  it('renders correctly with icons', () => {
    renderWithProvider();

    // Check for title and description
    expect(screen.getByText(/strength measures bodily power/i)).toBeInTheDocument();

    const decreaseBtn = screen.getByRole('button', { name: /decrease strength/i });
    const increaseBtn = screen.getByRole('button', { name: /increase strength/i });

    expect(decreaseBtn).toHaveAttribute('type', 'button');
    expect(increaseBtn).toHaveAttribute('type', 'button');

    // Check for final score and modifier accessibility
    expect(screen.getByLabelText(/final strength score: 12/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/strength modifier: \+1/i)).toBeInTheDocument();

    // Check for racial bonus badge
    const racialBadge = screen.getByText(/\+2 racial/i);
    expect(racialBadge).toBeInTheDocument();
    expect(racialBadge).toHaveAttribute('title', 'Racial ability score bonus');
    expect(racialBadge).toHaveAttribute('aria-label', '+2 racial bonus to strength');
  });

  it('calls onIncrease and onDecrease handlers', () => {
    renderWithProvider();

    const decreaseBtn = screen.getByRole('button', { name: /decrease strength/i });
    const increaseBtn = screen.getByRole('button', { name: /increase strength/i });

    fireEvent.click(decreaseBtn);
    expect(defaultProps.onDecrease).toHaveBeenCalledWith('strength');

    fireEvent.click(increaseBtn);
    expect(defaultProps.onIncrease).toHaveBeenCalledWith('strength');
  });

  it('disables buttons correctly', () => {
    const { rerender } = render(
      <TooltipProvider delayDuration={0}>
        <AbilityScoreCard {...defaultProps} baseScore={8} />
      </TooltipProvider>,
    );
    const decreaseBtn = screen.getByRole('button', { name: /decrease strength/i });
    expect(decreaseBtn).toBeDisabled();

    rerender(
      <TooltipProvider delayDuration={0}>
        <AbilityScoreCard {...defaultProps} baseScore={15} />
      </TooltipProvider>,
    );
    const increaseBtn = screen.getByRole('button', { name: /increase strength/i });
    expect(increaseBtn).toBeDisabled();

    rerender(
      <TooltipProvider delayDuration={0}>
        <AbilityScoreCard {...defaultProps} method="standardArray" />
      </TooltipProvider>,
    );
    expect(screen.getByRole('button', { name: /decrease strength/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /increase strength/i })).toBeDisabled();
  });
});
