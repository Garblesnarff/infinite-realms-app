import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';

import DeathSaveManager from '../DeathSaveManager';

import type { CombatParticipant } from '@/types/combat';

describe('DeathSaveManager', () => {
  const mockParticipant = {
    id: 'p1',
    name: 'Valerius',
    deathSaves: {
      successes: 1,
      failures: 2,
    },
  } as unknown as CombatParticipant;

  const mockOnDeathSave = vi.fn();

  it('renders participant name and current death saves state correctly', () => {
    render(
      <DeathSaveManager
        participant={mockParticipant}
        onDeathSave={mockOnDeathSave}
      />
    );

    // Verify name rendering
    expect(screen.getByText('Dying: Valerius')).toBeInTheDocument();

    // Verify stats are visible
    expect(screen.getByText('Successes')).toBeInTheDocument();
    expect(screen.getByText('Failures')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('contains the correct accessibility attributes for live state updates', () => {
    render(
      <DeathSaveManager
        participant={mockParticipant}
        onDeathSave={mockOnDeathSave}
      />
    );

    // Verify the status container has the correct ARIA attributes
    const statusContainer = screen.getByRole('status');
    expect(statusContainer).toBeInTheDocument();
    expect(statusContainer).toHaveAttribute('aria-live', 'polite');
    expect(statusContainer).toHaveAttribute(
      'aria-label',
      'Death saving throws for Valerius: 1 successes, 2 failures'
    );
  });

  it('triggers onDeathSave callback when clicking the roll button', () => {
    render(
      <DeathSaveManager
        participant={mockParticipant}
        onDeathSave={mockOnDeathSave}
      />
    );

    const rollButton = screen.getByRole('button', {
      name: 'Roll a d20 death saving throw for Valerius',
    });
    expect(rollButton).toBeInTheDocument();
    expect(rollButton).toHaveAttribute('type', 'button');

    fireEvent.click(rollButton);
    expect(mockOnDeathSave).toHaveBeenCalledTimes(1);
    expect(mockOnDeathSave).toHaveBeenCalledWith('p1');
  });
});
