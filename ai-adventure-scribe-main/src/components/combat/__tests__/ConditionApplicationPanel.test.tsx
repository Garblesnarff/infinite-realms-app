/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

import { CONDITION_TEMPLATES } from '../condition-utils';
import { ConditionApplicationPanel } from '../ConditionApplicationPanel';

// Mock Select components using a simpler approach that renders standard HTML elements directly
vi.mock('@/components/ui/select', () => ({
  Select: ({ children, onValueChange, value }: any) => {
    // We expect two select elements, so we'll just handle them simply
    return (
      <select
        value={value || ''}
        onChange={(e) => onValueChange(e.target.value)}
        data-testid="select-mock"
      >
        <option value="">Select...</option>
        {children}
      </select>
    );
  },
  SelectTrigger: ({ children }: any) => <>{children}</>,
  SelectValue: ({ placeholder }: any) => <>{placeholder}</>,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ children, value }: any) => (
    <option value={value}>{children}</option>
  ),
}));

// Mock Lucide icons
vi.mock('lucide-react', () => ({
  UserX: () => <div data-testid="icon-userx" />,
  X: () => <div data-testid="icon-x" />,
  Heart: () => <div data-testid="icon-heart" />,
  Skull: () => <div data-testid="icon-skull" />,
  Clock: () => <div data-testid="icon-clock" />,
}));

describe('ConditionApplicationPanel', () => {
  const mockOnApplyCondition = vi.fn();
  const mockOnRemoveCondition = vi.fn();

  const participants = [
    {
      id: 'p1',
      name: 'Hero',
      conditions: [
        {
          name: 'poisoned' as const,
          duration: 3,
          description: 'Disadvantage on attack rolls and ability checks',
          saveEndsType: 'end' as const,
          saveDC: 12,
          saveAbility: 'con' as const,
          concentrationRequired: false
        }
      ]
    },
    {
      id: 'p2',
      name: 'Goblin',
      conditions: []
    }
  ];

  const defaultProps = {
    onApplyCondition: mockOnApplyCondition,
    onRemoveCondition: mockOnRemoveCondition,
    participants: participants as any,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders correctly with headings', () => {
    render(<ConditionApplicationPanel {...defaultProps} />);

    expect(screen.getByRole('heading', { name: /Apply Condition/i })).toBeInTheDocument();
    expect(screen.getByText('Managing Conditions')).toBeInTheDocument();
  });

  it('updates description when a condition is selected', () => {
    render(<ConditionApplicationPanel {...defaultProps} />);

    const conditionSelect = screen.getAllByTestId('select-mock')[0];
    fireEvent.change(conditionSelect, { target: { value: 'blinded' } });

    expect(screen.getByText(CONDITION_TEMPLATES.blinded.description)).toBeInTheDocument();
  });

  it('enables Apply button only when both condition and target are selected', () => {
    render(<ConditionApplicationPanel {...defaultProps} />);

    const applyButton = screen.getByRole('button', { name: /Apply Condition/i });
    expect(applyButton).toBeDisabled();

    const selects = screen.getAllByTestId('select-mock');
    const conditionSelect = selects[0];
    const targetSelect = selects[1];

    fireEvent.change(conditionSelect, { target: { value: 'blinded' } });
    expect(applyButton).toBeDisabled();

    fireEvent.change(targetSelect, { target: { value: 'p2' } });
    expect(applyButton).not.toBeDisabled();
  });

  it('calls onApplyCondition and resets state when Apply is clicked', () => {
    render(<ConditionApplicationPanel {...defaultProps} />);

    const selects = screen.getAllByTestId('select-mock');
    const conditionSelect = selects[0];
    const targetSelect = selects[1];

    fireEvent.change(conditionSelect, { target: { value: 'blinded' } });
    fireEvent.change(targetSelect, { target: { value: 'p2' } });

    const durationInput = screen.getByLabelText(/Duration/i);
    fireEvent.change(durationInput, { target: { value: '5' } });

    const applyButton = screen.getByRole('button', { name: /Apply Blinded/i });
    fireEvent.click(applyButton);

    expect(mockOnApplyCondition).toHaveBeenCalledWith({
      name: 'blinded',
      description: CONDITION_TEMPLATES.blinded.description,
      duration: 5,
      saveEndsType: 'end',
      saveDC: 12,
      saveAbility: 'con',
      concentrationRequired: false,
    }, 'p2');

    // Reset state checks
    expect(applyButton).toBeDisabled();
    expect((conditionSelect as HTMLSelectElement).value).toBe('');
    expect((targetSelect as HTMLSelectElement).value).toBe('');
    expect((durationInput as HTMLInputElement).value).toBe('3');
  });

  it('uses default duration from template when duration is 0', () => {
    render(<ConditionApplicationPanel {...defaultProps} />);

    const selects = screen.getAllByTestId('select-mock');
    const conditionSelect = selects[0];
    const targetSelect = selects[1];

    fireEvent.change(conditionSelect, { target: { value: 'stunned' } });
    fireEvent.change(targetSelect, { target: { value: 'p2' } });

    const durationInput = screen.getByLabelText(/Duration/i);
    fireEvent.change(durationInput, { target: { value: '0' } });

    fireEvent.click(screen.getByRole('button', { name: /Apply Stunned/i }));

    expect(mockOnApplyCondition).toHaveBeenCalledWith(expect.objectContaining({
      name: 'stunned',
      duration: CONDITION_TEMPLATES.stunned.defaultDuration,
      saveAbility: undefined
    }), 'p2');
  });

  it('calls onRemoveCondition when remove button is clicked', () => {
    render(<ConditionApplicationPanel {...defaultProps} />);

    // Hero (p1) has 'poisoned' condition
    const removeButton = screen.getByLabelText(/Remove poisoned from Hero/i);
    fireEvent.click(removeButton);

    expect(mockOnRemoveCondition).toHaveBeenCalledWith('poisoned', 'p1');
  });

  it('verifies accessibility attributes for managing section', () => {
    render(<ConditionApplicationPanel {...defaultProps} />);

    const managingSection = screen.getByRole('status');
    expect(managingSection).toHaveAttribute('aria-live', 'polite');
  });

  it('shows empty state message when no participants have conditions', () => {
    const emptyParticipants = [
      { id: 'p1', name: 'Hero', conditions: [] },
      { id: 'p2', name: 'Goblin', conditions: [] }
    ];
    render(<ConditionApplicationPanel {...defaultProps} participants={emptyParticipants as any} />);

    expect(screen.getByText('No active conditions on participants.')).toBeInTheDocument();
  });
});
