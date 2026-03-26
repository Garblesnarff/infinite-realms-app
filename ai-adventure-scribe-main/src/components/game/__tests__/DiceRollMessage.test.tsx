/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import React from 'react';
import { DiceRollMessage } from '../DiceRollMessage';

describe('DiceRollMessage', () => {
  const defaultData = {
    formula: '1d20+4',
    count: 1,
    dieType: 20,
    modifier: 4,
    advantage: false,
    disadvantage: false,
    results: [15],
    total: 19,
    naturalRoll: 15,
    timestamp: new Date().toISOString(),
  };

  it('renders basic roll information correctly with accessibility attributes', () => {
    const { container } = render(<DiceRollMessage data={defaultData} />);

    // Check for status role and live region
    const card = container.firstChild as HTMLElement;
    expect(card).toHaveAttribute('role', 'status');
    expect(card).toHaveAttribute('aria-live', 'polite');
    expect(card).toHaveAttribute('aria-atomic', 'true');

    // Check for formula and total labels
    expect(screen.getByLabelText('Formula: 1d20+4')).toBeInTheDocument();
    expect(screen.getByLabelText('Total result: 19')).toBeInTheDocument();

    expect(screen.getByText('1d20+4')).toBeInTheDocument();
    expect(screen.getByText('19')).toBeInTheDocument();
  });

  it('renders player name and label when provided', () => {
    render(<DiceRollMessage data={{ ...defaultData, label: 'Initiative' }} playerName="Grog" />);

    expect(screen.getByText(/Grog rolled: Initiative/)).toBeInTheDocument();
  });

  it('renders advantage badge and kept/dropped rolls with accessibility labels', () => {
    const advantageData = {
      ...defaultData,
      formula: '2d20kh1+4',
      advantage: true,
      results: [18, 5],
      keptResults: [18],
      total: 22,
      naturalRoll: 18,
    };

    render(<DiceRollMessage data={advantageData} />);

    expect(screen.getByLabelText('Roll modifiers')).toBeInTheDocument();
    expect(screen.getByLabelText('Advantage')).toBeInTheDocument();
    expect(screen.getByLabelText('Individual roll breakdown')).toBeInTheDocument();
    expect(screen.getByText(/Kept: \[18\]/)).toBeInTheDocument();
    expect(screen.getByText(/Dropped: \[5\]/)).toBeInTheDocument();
  });

  it('renders disadvantage badge and kept/dropped rolls', () => {
    const disadvantageData = {
      ...defaultData,
      formula: '2d20kl1+4',
      disadvantage: true,
      results: [18, 5],
      keptResults: [5],
      total: 9,
      naturalRoll: 5,
    };

    render(<DiceRollMessage data={disadvantageData} />);

    expect(screen.getByText(/Disadvantage/i)).toBeInTheDocument();
    expect(screen.getByText(/Kept: \[5\]/)).toBeInTheDocument();
    expect(screen.getByText(/Dropped: \[18\]/)).toBeInTheDocument();
  });

  it('displays critical success styling for natural 20', () => {
    const critData = {
      ...defaultData,
      results: [20],
      total: 24,
      naturalRoll: 20,
      critical: true,
    };

    render(<DiceRollMessage data={critData} />);

    const totalElement = screen.getByText('24');
    expect(totalElement).toHaveClass('text-green-600');
    expect(screen.getByText(/Critical Success!/)).toBeInTheDocument();
    // Use getAllByText because naturalRoll might appear in multiple places
    expect(screen.getAllByText(/Natural 20/i).length).toBeGreaterThan(0);
  });

  it('displays critical failure styling for natural 1', () => {
    const failData = {
      ...defaultData,
      results: [1],
      total: 5,
      naturalRoll: 1,
      critical: false,
    };

    render(<DiceRollMessage data={failData} />);

    const totalElement = screen.getByText('5');
    expect(totalElement).toHaveClass('text-red-600');
    expect(screen.getByText(/Critical Failure!/)).toBeInTheDocument();
    // Use getAllByText because "Natural 1" appears in the critical failure badge and the special callout
    expect(screen.getAllByText(/Natural 1/i).length).toBeGreaterThan(0);
  });

  it('displays individual rolls for multiple dice (non-adv/disadv)', () => {
    const multiData = {
      ...defaultData,
      formula: '2d6+4',
      count: 2,
      dieType: 6,
      results: [4, 5],
      total: 13,
    };

    render(<DiceRollMessage data={multiData} />);

    expect(screen.getByText(/Individual rolls: \[4, 5\]/)).toBeInTheDocument();
  });

  it('applies high roll styling for natural 15-19 on d20', () => {
    render(<DiceRollMessage data={{ ...defaultData, naturalRoll: 15 }} />);
    const totalElement = screen.getByText('19');
    expect(totalElement).toHaveClass('text-green-500');
  });

  it('applies low roll styling for natural 2-5 on d20', () => {
    render(<DiceRollMessage data={{ ...defaultData, naturalRoll: 3, total: 7 }} />);
    const totalElement = screen.getByText('7');
    expect(totalElement).toHaveClass('text-orange-500');
  });

  it('displays Natural 20 badge even when critical is undefined', () => {
    render(<DiceRollMessage data={{ ...defaultData, naturalRoll: 20, total: 24 }} />);
    expect(screen.getByText(/Natural 20!/)).toBeInTheDocument();
  });

  it('displays Natural 1 badge even when critical is undefined', () => {
    render(<DiceRollMessage data={{ ...defaultData, naturalRoll: 1, total: 5 }} />);
    expect(screen.getByText(/Natural 1.../)).toBeInTheDocument();
  });

  it('handles missing keptResults for advantage/disadvantage by taking the first result', () => {
    const fallbackData = {
      ...defaultData,
      advantage: true,
      results: [15, 10],
      keptResults: undefined,
      total: 19,
    };

    render(<DiceRollMessage data={fallbackData} />);
    expect(screen.getByText(/Kept: \[15\]/)).toBeInTheDocument();
    expect(screen.getByText(/Dropped: \[10\]/)).toBeInTheDocument();
  });
});
