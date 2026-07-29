import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';

import DiceRoller from '../dice-roller';

// Mock the components that might use complex logic or context
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe('DiceRoller Accessibility', () => {
  it('renders a roll button with an aria-label and no title', () => {
    render(<DiceRoller dice="1d20" label="Attack" />);

    const button = screen.getByRole('button', { name: /roll attack/i });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-label', 'Roll Attack');
    expect(button).not.toHaveAttribute('title');
    expect(button).toHaveAttribute('type', 'button');
  });

  it('renders a display-only element with tabIndex and no title', () => {
    render(<DiceRoller dice="1d8" label="Longsword" displayOnly />);

    const display = screen.getByLabelText(/dice: longsword/i);
    expect(display).toBeInTheDocument();
    expect(display).toHaveAttribute('tabIndex', '0');
    expect(display).not.toHaveAttribute('title');
  });

  it('shows the roll result in a focusable badge with an aria-label', async () => {
    render(<DiceRoller dice="1d6" onRoll={() => {}} />);

    const button = screen.getByRole('button', { name: /roll 1d6/i });
    fireEvent.click(button);

    // The roll result badge should appear after a short delay (mocked timeout in component)
    const resultBadge = await screen.findByLabelText(/last roll total: \d+\. Formula: 1d6\. Individual rolls: \d+\./i);
    expect(resultBadge).toBeInTheDocument();
    expect(resultBadge).toHaveAttribute('tabIndex', '0');
    expect(resultBadge).not.toHaveAttribute('title');
  });

  it('marks icons as aria-hidden', () => {
    render(<DiceRoller dice="1d20" advantage />);

    // Dice icon in button
    const diceIcon = document.querySelector('svg.lucide-dice6');
    expect(diceIcon).toHaveAttribute('aria-hidden', 'true');

    // Plus icon in advantage badge
    const plusIcon = document.querySelector('svg.lucide-plus');
    expect(plusIcon).toHaveAttribute('aria-hidden', 'true');
  });

  it('handles advantage and disadvantage rolls', async () => {
    const { rerender } = render(<DiceRoller dice="1d20" advantage />);
    let button = screen.getByRole('button', { name: /roll 1d20/i });
    fireEvent.click(button);
    await screen.findByLabelText(/last roll total:/i);

    rerender(<DiceRoller dice="1d20" disadvantage />);
    button = screen.getByRole('button', { name: /roll 1d20/i });
    fireEvent.click(button);
    await screen.findByLabelText(/last roll total:/i);
  });

  it('handles malformed dice strings', () => {
    // Should default to 1d20 if malformed
    render(<DiceRoller dice="invalid" />);
    const button = screen.getByRole('button', { name: /roll invalid/i });
    expect(button).toBeInTheDocument();

    fireEvent.click(button);
    // Even if dice is "invalid", it uses 1d20 default internally in parseDiceString
  });
});
