import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GameLoadingOverlay, LOADING_STALL_TIMEOUT_MS } from '../GameLoadingOverlay';

// #865: the initialization overlay must not spin forever — a load that
// outlives the stall bound surfaces a reload control.
describe('GameLoadingOverlay stall escape', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });

  it('shows the phase message with no reload control before the stall bound', () => {
    render(<GameLoadingOverlay loadingPhase="data" />);

    expect(screen.getByText('Preparing Your Adventure')).toBeInTheDocument();
    expect(screen.getByText('Loading character and campaign data...')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reload' })).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(LOADING_STALL_TIMEOUT_MS - 1);
    });
    expect(screen.queryByRole('button', { name: 'Reload' })).not.toBeInTheDocument();
  });

  it('surfaces a working reload control once the load outlives the stall bound', () => {
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { reload },
    });

    render(<GameLoadingOverlay loadingPhase="data" />);
    act(() => {
      vi.advanceTimersByTime(LOADING_STALL_TIMEOUT_MS);
    });

    expect(screen.getByText(/taking longer than usual/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('measures no progress, not mount time — a phase change re-arms the bound', () => {
    const { rerender } = render(<GameLoadingOverlay loadingPhase="initial" />);

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    rerender(<GameLoadingOverlay loadingPhase="data" />);

    // 60s since mount but only 30s since the last progress: no stall yet.
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.queryByRole('button', { name: 'Reload' })).not.toBeInTheDocument();

    // 45s with no further progress: stalled.
    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });
});
