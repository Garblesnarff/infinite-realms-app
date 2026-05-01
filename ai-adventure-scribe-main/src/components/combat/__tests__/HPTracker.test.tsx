import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { vi, describe, it, expect } from 'vitest';

import HPTracker from '../HPTracker';

import type { CombatParticipant } from '@/types/combat';

describe('HPTracker', () => {
  const participant = {
    id: 'p1',
    name: 'Thorin Ironforge',
    participantType: 'player',
    initiative: { value: 18 },
    armorClass: 16,
    maxHitPoints: 45,
    currentHitPoints: 45,
    temporaryHitPoints: 0,
    conditions: [],
    deathSaves: { successes: 0, failures: 0 },
    actionTaken: false,
    bonusActionTaken: false,
    reactionTaken: false,
    movementUsed: 0,
  } as unknown as CombatParticipant;

  const defaultProps = {
    participant,
    onDamage: vi.fn(),
    onHeal: vi.fn(),
    showHPDetails: true,
    isInteractive: true,
  };

  it('renders correctly with descriptive ARIA labels', () => {
    render(<HPTracker {...defaultProps} />);

    // Check for participant name
    expect(screen.getByText('Thorin Ironforge')).toBeInTheDocument();

    // Check for progress bar aria-label
    const progress = screen.getByRole('progressbar');
    expect(progress).toHaveAttribute('aria-label', expect.stringContaining('Thorin Ironforge health'));

    // Check for damage input and label
    const damageInput = screen.getByPlaceholderText('Damage');
    expect(damageInput).toHaveAttribute('id');
    const damageInputId = damageInput.getAttribute('id');

    // Label should be linked and contain participant name
    const damageLabel = screen.getByText(`Damage amount for Thorin Ironforge`);
    expect(damageLabel).toHaveAttribute('for', damageInputId);

    // Damage button should have descriptive labels
    const damageButton = screen.getByRole('button', { name: /apply damage to thorin ironforge/i });
    expect(damageButton).toHaveAttribute('title', 'Apply damage to Thorin Ironforge');

    // Check for heal input and label
    const healInput = screen.getByPlaceholderText('Heal');
    expect(healInput).toHaveAttribute('id');
    const healInputId = healInput.getAttribute('id');

    // Label should be linked and contain participant name
    const healLabel = screen.getByText(`Healing amount for Thorin Ironforge`);
    expect(healLabel).toHaveAttribute('for', healInputId);

    // Heal button should have descriptive labels
    const healButton = screen.getByRole('button', { name: /apply healing to thorin ironforge/i });
    expect(healButton).toHaveAttribute('title', 'Apply healing to Thorin Ironforge');
  });

  it('calls onDamage and onHeal handlers with correct values', () => {
    render(<HPTracker {...defaultProps} />);

    const damageInput = screen.getByPlaceholderText('Damage');
    const damageButton = screen.getByRole('button', { name: /apply damage to thorin ironforge/i });

    fireEvent.change(damageInput, { target: { value: '10' } });
    fireEvent.click(damageButton);
    expect(defaultProps.onDamage).toHaveBeenCalledWith('p1', 10, 'slashing');

    const healInput = screen.getByPlaceholderText('Heal');
    const healButton = screen.getByRole('button', { name: /apply healing to thorin ironforge/i });

    fireEvent.change(healInput, { target: { value: '5' } });
    fireEvent.click(healButton);
    expect(defaultProps.onHeal).toHaveBeenCalledWith('p1', 5);
  });

  it('hides exact HP and shows semantic status when showHPDetails is false', () => {
    const hiddenProps = {
      ...defaultProps,
      showHPDetails: false,
    };
    render(<HPTracker {...hiddenProps} />);

    // Exact HP numbers should NOT be visible
    expect(screen.queryByText('45 / 45')).not.toBeInTheDocument();

    // Semantic status should be visible (45/45 is 100%, which is "Healthy")
    expect(screen.getByText('Healthy')).toBeInTheDocument();

    // Progress bar aria-label should use semantic status
    const progress = screen.getByRole('progressbar');
    expect(progress).toHaveAttribute('aria-label', 'Thorin Ironforge health: Healthy');
    expect(progress).toHaveAttribute('title', 'Healthy');
  });

  it('shows "Near Death" semantic status when HP is low and hidden', () => {
    const woundedParticipant = {
      ...participant,
      currentHitPoints: 5, // ~11% of 45
    };
    const hiddenProps = {
      ...defaultProps,
      participant: woundedParticipant,
      showHPDetails: false,
    };
    render(<HPTracker {...hiddenProps} />);

    expect(screen.getByText('Near Death')).toBeInTheDocument();
    const progress = screen.getByRole('progressbar');
    expect(progress).toHaveAttribute('aria-label', 'Thorin Ironforge health: Near Death');
  });
});
