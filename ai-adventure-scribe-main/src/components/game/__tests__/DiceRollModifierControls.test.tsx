import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';

import { DiceRollModifierControls } from '../DiceRollModifierControls';

describe('DiceRollModifierControls', () => {
  const mockToggleAdvantage = vi.fn();
  const mockToggleDisadvantage = vi.fn();

  it('renders correctly with default state', () => {
    render(
      <DiceRollModifierControls
        hasAdvantage={false}
        hasDisadvantage={false}
        onToggleAdvantage={mockToggleAdvantage}
        onToggleDisadvantage={mockToggleDisadvantage}
      />,
    );

    const advButton = screen.getByRole('button', { name: /Enable Advantage/i });
    const disButton = screen.getByRole('button', { name: /Enable Disadvantage/i });

    expect(advButton).toBeInTheDocument();
    expect(disButton).toBeInTheDocument();
    expect(advButton).toHaveAttribute('aria-pressed', 'false');
    expect(disButton).toHaveAttribute('aria-pressed', 'false');
  });

  it('reflects advantage state', () => {
    render(
      <DiceRollModifierControls
        hasAdvantage={true}
        hasDisadvantage={false}
        onToggleAdvantage={mockToggleAdvantage}
        onToggleDisadvantage={mockToggleDisadvantage}
      />,
    );

    const advButton = screen.getByRole('button', { name: /Disable Advantage/i });
    expect(advButton).toHaveAttribute('aria-pressed', 'true');
    expect(advButton).toHaveClass('bg-green-600');
  });

  it('reflects disadvantage state', () => {
    render(
      <DiceRollModifierControls
        hasAdvantage={false}
        hasDisadvantage={true}
        onToggleAdvantage={mockToggleAdvantage}
        onToggleDisadvantage={mockToggleDisadvantage}
      />,
    );

    const disButton = screen.getByRole('button', { name: /Disable Disadvantage/i });
    expect(disButton).toHaveAttribute('aria-pressed', 'true');
    expect(disButton).toHaveClass('bg-red-600');
  });

  it('calls toggle functions on click', () => {
    render(
      <DiceRollModifierControls
        hasAdvantage={false}
        hasDisadvantage={false}
        onToggleAdvantage={mockToggleAdvantage}
        onToggleDisadvantage={mockToggleDisadvantage}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Enable Advantage/i }));
    expect(mockToggleAdvantage).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /Enable Disadvantage/i }));
    expect(mockToggleDisadvantage).toHaveBeenCalledTimes(1);
  });

  it('portals the Advantage tooltip out of the modifier layout flow', async () => {
    const user = userEvent.setup();
    render(
      <DiceRollModifierControls
        hasAdvantage={false}
        hasDisadvantage={false}
        onToggleAdvantage={mockToggleAdvantage}
        onToggleDisadvantage={mockToggleDisadvantage}
      />,
    );

    const group = screen.getByRole('group', { name: /Roll modifiers/i });
    await user.hover(screen.getByRole('button', { name: /Enable Advantage/i }));

    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('Enable Advantage');
    expect(group).not.toContainElement(tooltip);
    expect(document.body).toContainElement(tooltip);
  });
});
