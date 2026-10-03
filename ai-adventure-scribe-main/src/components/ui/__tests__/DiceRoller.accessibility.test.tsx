import { act, render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import DiceRoller from '../dice-roller';

// Mock the components that might use complex logic or context
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe('DiceRoller Accessibility', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

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

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    const resultBadge = screen.getByLabelText(
      /last roll total: \d+\. Formula: 1d6\. Individual rolls: \d+\./i,
    );
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
    const onRoll = vi.fn();
    const random = vi.spyOn(Math, 'random').mockReturnValueOnce(0.1).mockReturnValueOnce(0.8);
    const { rerender } = render(<DiceRoller dice="1d20" advantage onRoll={onRoll} />);
    let button = screen.getByRole('button', { name: /roll 1d20/i });
    fireEvent.click(button);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(screen.getByLabelText(/last roll total: 17\./i)).toBeInTheDocument();
    expect(onRoll).toHaveBeenCalledTimes(1);
    expect(onRoll).toHaveBeenLastCalledWith(expect.objectContaining({ total: 17, rolls: [17] }));

    random.mockReturnValueOnce(0.1).mockReturnValueOnce(0.8);
    rerender(<DiceRoller dice="1d20" disadvantage onRoll={onRoll} />);
    button = screen.getByRole('button', { name: /roll 1d20/i });
    fireEvent.click(button);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(screen.getByLabelText(/last roll total: 3\./i)).toBeInTheDocument();
    expect(onRoll).toHaveBeenCalledTimes(2);
    expect(onRoll).toHaveBeenLastCalledWith(expect.objectContaining({ total: 3, rolls: [3] }));
  });

  it('handles malformed dice strings', async () => {
    // Should default to 1d20 if malformed
    render(<DiceRoller dice="invalid" />);
    const button = screen.getByRole('button', { name: /roll invalid/i });
    expect(button).toBeInTheDocument();

    fireEvent.click(button);
    // Even if dice is "invalid", it uses 1d20 default internally in parseDiceString
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(screen.getByLabelText(/last roll total:/i)).toBeInTheDocument();
  });
});
