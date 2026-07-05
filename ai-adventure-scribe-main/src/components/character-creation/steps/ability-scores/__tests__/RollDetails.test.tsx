import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { vi, describe, it, expect } from 'vitest';

import RollDetails from '../RollDetails';

describe('RollDetails', () => {
  const defaultProps = {
    currentRollDetails: {
      timestamp: new Date('2024-01-01T12:00:00'),
      details: [
        {
          rolls: [4, 5, 6, 1],
          dropped: 1,
          total: 15,
        },
        // ... (can add more details if needed for completeness)
      ] as any[],
    } as any,
    abilities: ['strength'] as any[],
    onRerollSingle: vi.fn(),
  };

  it('renders correctly with RotateCcw icon and tooltip', () => {
    render(<RollDetails {...defaultProps} />);

    // Check for "Current Roll Details" text
    expect(screen.getByText(/current roll details/i)).toBeInTheDocument();

    // Check for "Reroll" button
    const rerollBtn = screen.getByRole('button', { name: /reroll strength/i });
    expect(rerollBtn).toBeInTheDocument();
    expect(rerollBtn).toHaveAttribute('type', 'button');

    // Check for rolls with aria-labels
    expect(screen.getByLabelText('Rolled 4')).toBeInTheDocument();
    expect(screen.getByLabelText('Rolled 5')).toBeInTheDocument();
    expect(screen.getByLabelText('Rolled 6')).toBeInTheDocument();
    expect(screen.getByLabelText('Rolled 1, dropped')).toBeInTheDocument();

    // Check for rolls text content
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();

    // Check for dropped roll
    const droppedRoll = screen.getByText('1');
    expect(droppedRoll).toBeInTheDocument();
  });

  it('calls onRerollSingle handler', () => {
    render(<RollDetails {...defaultProps} />);

    const rerollBtn = screen.getByRole('button', { name: /reroll/i });
    fireEvent.click(rerollBtn);
    expect(defaultProps.onRerollSingle).toHaveBeenCalledWith(0);
  });
});
