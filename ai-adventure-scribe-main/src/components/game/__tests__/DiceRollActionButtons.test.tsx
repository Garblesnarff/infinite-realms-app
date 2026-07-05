import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';

import { DiceRollActionButtons } from '../DiceRollActionButtons';

describe('DiceRollActionButtons', () => {
  const mockAutoRoll = vi.fn();
  const mockEnterManually = vi.fn();
  const mockCancel = vi.fn();

  it('renders all buttons correctly', () => {
    render(
      <DiceRollActionButtons
        formula="1d20+5"
        purpose="Test Check"
        isRolling={false}
        onAutoRoll={mockAutoRoll}
        onEnterManually={mockEnterManually}
        onCancel={mockCancel}
      />
    );

    expect(screen.getByRole('button', { name: /Roll 1d20\+5 for Test Check/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Roll physical dice and enter result manually/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Dismiss roll request/i })).toBeInTheDocument();
  });

  it('shows rolling state', () => {
    render(
      <DiceRollActionButtons
        formula="1d20+5"
        purpose="Test Check"
        isRolling={true}
        onAutoRoll={mockAutoRoll}
        onEnterManually={mockEnterManually}
        onCancel={mockCancel}
      />
    );

    const rollButton = screen.getByRole('button', { name: /Roll 1d20\+5 for Test Check/i });
    expect(rollButton).toBeDisabled();
    expect(rollButton).toHaveTextContent(/Rolling\.\.\./i);

    expect(screen.getByRole('button', { name: /Roll physical dice and enter result manually/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Dismiss roll request/i })).toBeDisabled();
  });

  it('handles clicks correctly', () => {
    render(
      <DiceRollActionButtons
        formula="1d20+5"
        purpose="Test Check"
        isRolling={false}
        onAutoRoll={mockAutoRoll}
        onEnterManually={mockEnterManually}
        onCancel={mockCancel}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Roll 1d20\+5 for Test Check/i }));
    expect(mockAutoRoll).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /Roll physical dice and enter result manually/i }));
    expect(mockEnterManually).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /Dismiss roll request/i }));
    expect(mockCancel).toHaveBeenCalledTimes(1);
  });

  it('does not render cancel button if onCancel is not provided', () => {
    render(
      <DiceRollActionButtons
        formula="1d20+5"
        purpose="Test Check"
        isRolling={false}
        onAutoRoll={mockAutoRoll}
        onEnterManually={mockEnterManually}
      />
    );

    expect(screen.queryByRole('button', { name: /Dismiss roll request/i })).not.toBeInTheDocument();
  });
});
