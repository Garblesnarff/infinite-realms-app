import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TargetNumbersToggle } from '../TargetNumbersToggle';

const mockSetShowTargetNumbers = vi.fn();
let mockShowTargetNumbers = true;

vi.mock('../../../../hooks/use-show-target-numbers', () => ({
  useShowTargetNumbers: () => ({
    get showTargetNumbers() {
      return mockShowTargetNumbers;
    },
    setShowTargetNumbers: mockSetShowTargetNumbers,
  }),
}));

describe('TargetNumbersToggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockShowTargetNumbers = true;
  });

  it('renders button with correct label and aria-pressed state when On', () => {
    render(<TargetNumbersToggle />);
    const button = screen.getByRole('button', { name: 'Show target numbers: On' });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders button with correct label and aria-pressed state when Off', () => {
    mockShowTargetNumbers = false;
    render(<TargetNumbersToggle />);
    const button = screen.getByRole('button', { name: 'Show target numbers: Off' });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  it('toggles setting when clicked', () => {
    render(<TargetNumbersToggle />);
    const button = screen.getByRole('button', { name: 'Show target numbers: On' });
    fireEvent.click(button);
    expect(mockSetShowTargetNumbers).toHaveBeenCalledWith(false);
  });

  it('displays explanatory tooltip on focus', async () => {
    render(<TargetNumbersToggle />);
    const button = screen.getByRole('button', { name: 'Show target numbers: On' });

    fireEvent.focus(button);

    await waitFor(() => {
      const tooltip = screen.getByRole('tooltip');
      expect(tooltip).toBeInTheDocument();
      expect(tooltip.textContent).toMatch(/Armor Class \(AC\)/);
      expect(tooltip.textContent).toMatch(/Difficulty Class \(DC\)/);
      expect(tooltip.textContent).toMatch(/Easy and Medium/);
      expect(tooltip.textContent).toMatch(/Hard and Deadly/);
      expect(tooltip.textContent).toMatch(/overrides/i);
    });
  });

  it('displays explanatory tooltip on hover (pointerMove)', async () => {
    render(<TargetNumbersToggle />);
    const button = screen.getByRole('button', { name: 'Show target numbers: On' });

    fireEvent.pointerMove(button);

    await waitFor(() => {
      const tooltip = screen.getByRole('tooltip');
      expect(tooltip).toBeInTheDocument();
      expect(tooltip.textContent).toMatch(/Armor Class \(AC\)/);
      expect(tooltip.textContent).toMatch(/Difficulty Class \(DC\)/);
    });
  });
});
