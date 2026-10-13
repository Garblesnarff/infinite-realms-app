import { render, screen, fireEvent, act, type RenderResult } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ActionOptions } from '../ActionOptions';

// Mock logger
vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
  },
}));

// Mock lucide icons to avoid rendering issues in tests
vi.mock('lucide-react', () => ({
  Sword: () => <div data-testid="icon-sword" />,
  MessageCircle: () => <div data-testid="icon-message" />,
  Eye: () => <div data-testid="icon-eye" />,
  Zap: () => <div data-testid="icon-zap" />,
  User: () => <div data-testid="icon-user" />,
}));

describe('ActionOptions', () => {
  const mockOptions = [
    { id: 'opt-1', number: 1, text: 'Attack the goblin', fullText: '1. **Attack**' },
    { id: 'opt-2', number: 2, text: 'Talk to the merchant', fullText: '2. **Talk**' },
    { id: 'opt-3', number: 3, text: 'Look around', fullText: '3. **Look**' },
    { id: 'opt-4', number: 4, text: 'Cast a spell', fullText: '4. **Cast**' },
    { id: 'opt-5', number: 5, text: 'Do something else', fullText: '5. **Other**' },
  ];

  const onOptionSelect = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  it('should not show options initially if delay is set', () => {
    render(<ActionOptions options={mockOptions} onOptionSelect={onOptionSelect} delay={1000} />);

    // Should show loading dots
    expect(screen.queryByText(/What would you like to do/i)).not.toBeInTheDocument();
  });

  it('should show options after the delay', () => {
    render(<ActionOptions options={mockOptions} onOptionSelect={onOptionSelect} delay={1000} />);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByText(/What would you like to do/i)).toBeInTheDocument();
    expect(screen.getByText(/Attack the goblin/i)).toBeInTheDocument();
  });

  it('should call onOptionSelect when an option is clicked', () => {
    render(<ActionOptions options={mockOptions} onOptionSelect={onOptionSelect} delay={0} />);

    act(() => {
      vi.runAllTimers();
    });

    const attackButton = screen.getByText(/Attack the goblin/i).closest('button');
    if (attackButton) {
      fireEvent.click(attackButton);
    }

    expect(onOptionSelect).toHaveBeenCalledWith(mockOptions[0]);
  });

  it('should disable all options after one is selected', () => {
    render(<ActionOptions options={mockOptions} onOptionSelect={onOptionSelect} delay={0} />);

    act(() => {
      vi.runAllTimers();
    });

    const attackButton = screen.getByText(/Attack the goblin/i).closest('button');
    const talkButton = screen.getByText(/Talk to the merchant/i).closest('button');

    if (attackButton) {
      fireEvent.click(attackButton);
      expect(attackButton).toHaveAttribute('aria-pressed', 'true');
    }

    expect(talkButton).toBeDisabled();

    // Clicking again should not call onOptionSelect
    if (attackButton) {
      fireEvent.click(attackButton);
    }
    expect(onOptionSelect).toHaveBeenCalledTimes(1);
  });

  it('should not call onOptionSelect if disabled prop is true', () => {
    render(
      <ActionOptions
        options={mockOptions}
        onOptionSelect={onOptionSelect}
        delay={0}
        disabled={true}
      />,
    );

    act(() => {
      vi.runAllTimers();
    });

    const attackButton = screen.getByText(/Attack the goblin/i).closest('button');
    if (attackButton) {
      fireEvent.click(attackButton);
    }

    expect(onOptionSelect).not.toHaveBeenCalled();
  });

  it('should show correct icons for different keywords', () => {
    render(<ActionOptions options={mockOptions} onOptionSelect={onOptionSelect} delay={0} />);

    act(() => {
      vi.runAllTimers();
    });

    expect(screen.getByTestId('icon-sword')).toBeInTheDocument();
    expect(screen.getByTestId('icon-message')).toBeInTheDocument();
    expect(screen.getByTestId('icon-eye')).toBeInTheDocument();
    expect(screen.getByTestId('icon-zap')).toBeInTheDocument();
    expect(screen.getByTestId('icon-user')).toBeInTheDocument();
  });

  it('should not render anything if options array is empty', () => {
    const { container } = render(<ActionOptions options={[]} onOptionSelect={onOptionSelect} />);

    expect(container.firstChild).toBeNull();
  });

  it('shows the full bold action name and wraps the description, never truncating (#2281)', () => {
    const description =
      'down the long corridor toward the kitchens, where something is clearly burning and nobody seems to care';
    render(
      <ActionOptions
        options={[
          {
            id: 'option-1',
            number: 1,
            text: `Follow the scorched-sugar smell, ${description}`,
            fullText: `**Follow the scorched-sugar smell**, ${description}`,
            title: 'Follow the scorched-sugar smell',
            description,
          },
        ]}
        onOptionSelect={onOptionSelect}
        delay={0}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(0);
    });

    const title = screen.getByText('Follow the scorched-sugar smell');
    const body = screen.getByText(description);
    expect(title).toHaveClass('font-semibold');
    const button = screen.getByRole('button', { name: /Option 1/ });
    expect(button).toHaveClass('whitespace-normal');
    expect(button).not.toHaveClass('whitespace-nowrap');
    for (const el of [title, body, button]) {
      expect(el.className).not.toMatch(/\b(truncate|text-ellipsis|line-clamp-\d)\b/);
    }
    expect(title).toHaveClass('break-words');
    expect(body).toHaveClass('break-words');
  });

  describe('option numbering (#2256)', () => {
    const showOptions = (options: typeof mockOptions) => {
      render(<ActionOptions options={options} onOptionSelect={onOptionSelect} delay={0} />);
      act(() => {
        vi.advanceTimersByTime(0);
      });
    };
    const labels = () => screen.getAllByText(/^Option \d+$/).map((node) => node.textContent);

    it('numbers options by position when the model repeats a number', () => {
      showOptions([
        { id: 'a', number: 1, text: 'Attack the goblin', fullText: '1.' },
        { id: 'b', number: 1, text: 'Talk to the merchant', fullText: '1.' },
        { id: 'c', number: 1, text: 'Look around', fullText: '1.' },
      ]);

      expect(labels()).toEqual(['Option 1', 'Option 2', 'Option 3']);
      expect(
        screen.getByRole('button', { name: 'Option 2 - Talk to the merchant' }),
      ).toBeInTheDocument();
    });

    it('numbers options by position when the model returns no number', () => {
      showOptions([
        { id: 'a', number: 0, text: 'Attack the goblin', fullText: '-' },
        { id: 'b', number: Number.NaN, text: 'Talk to the merchant', fullText: '-' },
      ]);

      expect(labels()).toEqual(['Option 1', 'Option 2']);
    });

    it('keeps the model numbers when they are already in order', () => {
      showOptions(mockOptions);

      expect(labels()).toEqual(['Option 1', 'Option 2', 'Option 3', 'Option 4', 'Option 5']);
    });
  });

  describe('stability during option reloads and explicit click instructions', () => {
    it('explains in accessible instruction text that clicking an option submits it immediately', () => {
      render(<ActionOptions options={mockOptions} onOptionSelect={onOptionSelect} delay={0} />);
      act(() => {
        vi.advanceTimersByTime(0);
      });

      expect(screen.getByText(/Select an option to submit it immediately/i)).toBeInTheDocument();
    });

    it('does not flicker back to loading state or reset timer when rerendered with equivalent option array', () => {
      const { rerender } = render(
        <ActionOptions options={mockOptions} onOptionSelect={onOptionSelect} delay={1000} />,
      );

      // Advance halfway
      act(() => {
        vi.advanceTimersByTime(500);
      });

      // Rerender with new array instance containing identical options
      const equivalentOptions = mockOptions.map((opt) => ({ ...opt }));
      rerender(
        <ActionOptions options={equivalentOptions} onOptionSelect={onOptionSelect} delay={1000} />,
      );

      // Advance remaining 500ms (total 1000ms from start)
      act(() => {
        vi.advanceTimersByTime(500);
      });

      // Should show options now because delay timer was preserved, not restarted
      expect(screen.getByText(/Attack the goblin/i)).toBeInTheDocument();
    });

    it('preserves displayed options in disabled state while the caller signals a refresh', () => {
      const { rerender } = render(
        <ActionOptions options={mockOptions} onOptionSelect={onOptionSelect} delay={0} />,
      );
      act(() => {
        vi.advanceTimersByTime(0);
      });

      expect(screen.getByText(/Attack the goblin/i)).toBeInTheDocument();

      // Options go empty with the caller signalling a refresh in flight (#118)
      rerender(
        <ActionOptions options={[]} onOptionSelect={onOptionSelect} delay={0} isLoading={true} />,
      );

      // The previous option buttons should remain visible (no flicker to empty/loading)
      const attackButton = screen.getByText(/Attack the goblin/i).closest('button');
      expect(attackButton).toBeInTheDocument();
      // But disabled so stale options cannot be submitted
      expect(attackButton).toBeDisabled();

      // Clicking disabled stale option should not invoke callback
      if (attackButton) {
        fireEvent.click(attackButton);
      }
      expect(onOptionSelect).not.toHaveBeenCalled();
    });

    it('updates options immediately without re-triggering initial delay when new options arrive', () => {
      const { rerender } = render(
        <ActionOptions options={mockOptions} onOptionSelect={onOptionSelect} delay={1000} />,
      );
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.getByText(/Attack the goblin/i)).toBeInTheDocument();

      const newOptions = [
        { id: 'opt-new-1', number: 1, text: 'Open the chest', fullText: '1. **Open**' },
      ];

      // Refreshing to [] first, then receiving new options
      rerender(<ActionOptions options={[]} onOptionSelect={onOptionSelect} delay={1000} />);
      rerender(<ActionOptions options={newOptions} onOptionSelect={onOptionSelect} delay={1000} />);

      // New options should be visible immediately without waiting another 1000ms
      expect(screen.getByText(/Open the chest/i)).toBeInTheDocument();
      const openButton = screen.getByText(/Open the chest/i).closest('button');
      expect(openButton).not.toBeDisabled();
    });
  });

  describe('loading / final-empty lifecycle (#118)', () => {
    const showImmediately = (options: typeof mockOptions, isLoading = false): RenderResult => {
      const utils = render(
        <ActionOptions
          options={options}
          onOptionSelect={onOptionSelect}
          delay={0}
          isLoading={isLoading}
        />,
      );
      act(() => {
        vi.advanceTimersByTime(0);
      });
      return utils;
    };

    const refreshTo = (
      rerender: RenderResult['rerender'],
      options: typeof mockOptions,
      isLoading: boolean,
    ): void => {
      rerender(
        <ActionOptions
          options={options}
          onOptionSelect={onOptionSelect}
          delay={0}
          isLoading={isLoading}
        />,
      );
    };

    it('transitions from loading to options when the first options arrive', () => {
      const { rerender } = render(
        <ActionOptions options={[]} onOptionSelect={onOptionSelect} delay={0} />,
      );
      expect(screen.queryByText(/What would you like to do/i)).not.toBeInTheDocument();

      rerender(<ActionOptions options={mockOptions} onOptionSelect={onOptionSelect} delay={0} />);
      act(() => {
        vi.advanceTimersByTime(0);
      });

      expect(screen.getByText(/What would you like to do/i)).toBeInTheDocument();
      expect(screen.getByText(/Attack the goblin/i)).toBeInTheDocument();
    });

    it('retains disabled old options for a refresh lasting beyond five seconds', () => {
      const { rerender } = showImmediately(mockOptions);
      expect(screen.getByText(/Attack the goblin/i)).toBeInTheDocument();

      // The caller signals a refresh in flight: options go empty but the old
      // buttons stay on screen, disabled so a stale option can never submit.
      refreshTo(rerender, [], true);
      const attackButton = screen.getByText(/Attack the goblin/i).closest('button');
      expect(attackButton).toBeDisabled();
      if (attackButton) {
        fireEvent.click(attackButton);
      }
      expect(onOptionSelect).not.toHaveBeenCalled();

      // A refresh that outlasts the old five-second grace period still keeps the
      // old options: the explicit loading signal — not a timer — governs retention.
      act(() => {
        vi.advanceTimersByTime(6000);
      });
      expect(screen.getByText(/Attack the goblin/i)).toBeInTheDocument();
      expect(screen.getByText(/Attack the goblin/i).closest('button')).toBeDisabled();

      // The refresh completes with fresh options: they replace the stale ones,
      // enabled, without re-triggering the initial delay.
      const freshOptions = [
        { id: 'opt-new-1', number: 1, text: 'Open the chest', fullText: '1. **Open**' },
      ];
      refreshTo(rerender, freshOptions, false);
      expect(screen.queryByText(/Attack the goblin/i)).not.toBeInTheDocument();
      const openButton = screen.getByText(/Open the chest/i).closest('button');
      expect(openButton).not.toBeDisabled();
    });

    it('clears settled-empty controls immediately with no grace period', () => {
      const { rerender, container } = showImmediately(mockOptions);
      expect(screen.getByText(/Attack the goblin/i)).toBeInTheDocument();

      // Settled empty (no refresh in flight): the controls clear at once.
      refreshTo(rerender, [], false);
      expect(screen.queryByText(/Attack the goblin/i)).not.toBeInTheDocument();
      expect(container.firstChild).toBeNull();
    });

    it('clears immediately when a refresh ends with the array still empty', () => {
      const { rerender } = showImmediately(mockOptions);

      // Refresh in flight: old options retained, disabled.
      refreshTo(rerender, [], true);
      expect(screen.getByText(/Attack the goblin/i)).toBeInTheDocument();

      // A parent re-render handing us a new [] instance mid-refresh changes nothing.
      refreshTo(rerender, [], true);
      expect(screen.getByText(/Attack the goblin/i)).toBeInTheDocument();

      // Loading ends with no new options: final-empty clears immediately.
      refreshTo(rerender, [], false);
      expect(screen.queryByText(/Attack the goblin/i)).not.toBeInTheDocument();
    });

    it('submits a freshly arrived option exactly once after a refresh', () => {
      const { rerender } = showImmediately(mockOptions);

      // Refresh cycle with the explicit signal: options empty out while loading,
      // then a fresh set arrives as loading ends.
      refreshTo(rerender, [], true);
      const freshOptions = [
        { id: 'opt-new-1', number: 1, text: 'Open the chest', fullText: '1. **Open**' },
      ];
      refreshTo(rerender, freshOptions, false);

      // The stale option from before the refresh is gone; the fresh one is enabled.
      expect(screen.queryByText(/Attack the goblin/i)).not.toBeInTheDocument();
      const openButton = screen.getByText(/Open the chest/i).closest('button');
      expect(openButton).not.toBeDisabled();

      if (openButton) {
        fireEvent.click(openButton);
        fireEvent.click(openButton);
      }
      expect(onOptionSelect).toHaveBeenCalledTimes(1);
      expect(onOptionSelect).toHaveBeenCalledWith(freshOptions[0]);
    });
  });
});
