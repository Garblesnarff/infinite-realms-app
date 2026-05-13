import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { vi, describe, it, expect } from 'vitest';

import AbilityScoreCard from '../AbilityScoreCard';

import type { Method } from '@/hooks/use-ability-score-selection';
import type { AbilityScores } from '@/types/character';

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

  it('renders correctly with icons and tooltips', () => {
    render(<AbilityScoreCard {...defaultProps} />);

    // Check for title and description
    // Using getAllByText because "strength" appears in the header and in the button aria-labels/titles
    const strengthElements = screen.getAllByText(/strength/i);
    expect(strengthElements.length).toBeGreaterThan(0);
    expect(screen.getByText(/strength measures bodily power/i)).toBeInTheDocument();

    // Check for icons in buttons (by role/aria-label and checking for presence of SVG-like children is complex,
    // but we can verify the title and aria-label)
    const decreaseBtn = screen.getByRole('button', { name: /decrease strength/i });
    const increaseBtn = screen.getByRole('button', { name: /increase strength/i });

    expect(decreaseBtn).toHaveAttribute('title', 'Decrease strength');
    expect(increaseBtn).toHaveAttribute('title', 'Increase strength');
    expect(decreaseBtn).toHaveAttribute('type', 'button');
    expect(increaseBtn).toHaveAttribute('type', 'button');

    // Check for final score and modifier accessibility
    expect(screen.getByLabelText(/final strength score: 12/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/strength modifier: \+1/i)).toBeInTheDocument();

    // Check for racial bonus badge and its title
    const racialBadge = screen.getByText(/\+2 racial/i);
    expect(racialBadge).toBeInTheDocument();
    expect(racialBadge).toHaveAttribute('title', 'Racial ability score bonus');
    expect(racialBadge).toHaveAttribute('aria-label', '+2 racial bonus to strength');
  });

  it('calls onIncrease and onDecrease handlers', () => {
    render(<AbilityScoreCard {...defaultProps} />);

    const decreaseBtn = screen.getByRole('button', { name: /decrease strength/i });
    const increaseBtn = screen.getByRole('button', { name: /increase strength/i });

    fireEvent.click(decreaseBtn);
    expect(defaultProps.onDecrease).toHaveBeenCalledWith('strength');

    fireEvent.click(increaseBtn);
    expect(defaultProps.onIncrease).toHaveBeenCalledWith('strength');
  });

  it('disables buttons correctly', () => {
    const { rerender } = render(<AbilityScoreCard {...defaultProps} baseScore={8} />);
    const decreaseBtn = screen.getByRole('button', { name: /decrease strength/i });
    expect(decreaseBtn).toBeDisabled();

    rerender(<AbilityScoreCard {...defaultProps} baseScore={15} />);
    const increaseBtn = screen.getByRole('button', { name: /increase strength/i });
    expect(increaseBtn).toBeDisabled();

    rerender(<AbilityScoreCard {...defaultProps} method="standardArray" />);
    expect(screen.getByRole('button', { name: /decrease strength/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /increase strength/i })).toBeDisabled();
  });
});
