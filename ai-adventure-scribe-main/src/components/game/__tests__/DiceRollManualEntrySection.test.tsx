import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';

import { DiceRollManualEntrySection } from '../DiceRollManualEntrySection';

describe('DiceRollManualEntrySection', () => {
  const mockOnManualResultChange = vi.fn();
  const mockOnSubmit = vi.fn();
  const mockOnBackToRoll = vi.fn();
  const mockOnCancel = vi.fn();

  it('renders correctly in standard manual mode', () => {
    render(
      <DiceRollManualEntrySection
        manualMode={true}
        manualResult=""
        resolvedFormula="1d20+2"
        onManualResultChange={mockOnManualResultChange}
        onSubmit={mockOnSubmit}
        onBackToRoll={mockOnBackToRoll}
        onCancel={mockOnCancel}
      />
    );

    expect(screen.getByLabelText(/Enter your roll result:/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Enter total result\.\.\./i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Submit/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Back to Roll/i })).toBeInTheDocument();
  });

  it('renders correctly in forced manual mode (unresolved formula)', () => {
    render(
      <DiceRollManualEntrySection
        manualMode={false}
        manualResult=""
        resolvedFormula={null}
        onManualResultChange={mockOnManualResultChange}
        onSubmit={mockOnSubmit}
        onBackToRoll={mockOnBackToRoll}
        onCancel={mockOnCancel}
      />
    );

    expect(screen.getByLabelText(/Roll formula could not be resolved/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Back to Roll/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument();
  });

  it('disables submit button when result is empty or invalid', () => {
    const { rerender } = render(
      <DiceRollManualEntrySection
        manualMode={true}
        manualResult=""
        resolvedFormula="1d20"
        onManualResultChange={mockOnManualResultChange}
        onSubmit={mockOnSubmit}
        onBackToRoll={mockOnBackToRoll}
      />
    );

    expect(screen.getByRole('button', { name: /Submit/i })).toBeDisabled();

    rerender(
      <DiceRollManualEntrySection
        manualMode={true}
        manualResult="abc"
        resolvedFormula="1d20"
        onManualResultChange={mockOnManualResultChange}
        onSubmit={mockOnSubmit}
        onBackToRoll={mockOnBackToRoll}
      />
    );
    expect(screen.getByRole('button', { name: /Submit/i })).toBeDisabled();

    rerender(
      <DiceRollManualEntrySection
        manualMode={true}
        manualResult="15"
        resolvedFormula="1d20"
        onManualResultChange={mockOnManualResultChange}
        onSubmit={mockOnSubmit}
        onBackToRoll={mockOnBackToRoll}
      />
    );
    expect(screen.getByRole('button', { name: /Submit/i })).not.toBeDisabled();
  });

  it('handles result changes', () => {
    render(
      <DiceRollManualEntrySection
        manualMode={true}
        manualResult=""
        resolvedFormula="1d20"
        onManualResultChange={mockOnManualResultChange}
        onSubmit={mockOnSubmit}
        onBackToRoll={mockOnBackToRoll}
      />
    );

    const input = screen.getByPlaceholderText(/Enter total result\.\.\./i);
    fireEvent.change(input, { target: { value: '20' } });
    expect(mockOnManualResultChange).toHaveBeenCalledWith('20');
  });

  it('handles button clicks', () => {
    render(
      <DiceRollManualEntrySection
        manualMode={true}
        manualResult="15"
        resolvedFormula="1d20"
        onManualResultChange={mockOnManualResultChange}
        onSubmit={mockOnSubmit}
        onBackToRoll={mockOnBackToRoll}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Submit/i }));
    expect(mockOnSubmit).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /Back to Roll/i }));
    expect(mockOnBackToRoll).toHaveBeenCalledTimes(1);
  });
});
