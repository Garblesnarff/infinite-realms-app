/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen, act, fireEvent } from '@testing-library/react';
import React from 'react';
import { expect, vi, describe, it, beforeEach, afterEach } from 'vitest';

import { NPCRollDisplay } from '../NPCRollDisplay';

const baseRequest = {
  actorName: 'Goblins',
  purpose: 'Attack player',
  type: 'attack' as const,
  formula: '1d20+4',
  ac: 15,
};

const mockRollHit = {
  request: baseRequest,
  result: {
    total: 18,
    naturalRoll: 14,
    modifiers: 4,
  },
};

const mockRollMiss = {
  request: baseRequest,
  result: {
    total: 10,
    naturalRoll: 6,
    modifiers: 4,
  },
};

const mockRollCritical = {
  request: baseRequest,
  result: {
    total: 24,
    naturalRoll: 20,
    modifiers: 4,
    critical: true,
  },
};

const mockRollFumble = {
  request: baseRequest,
  result: {
    total: 5,
    naturalRoll: 1,
    modifiers: 4,
  },
};

const mockRollSuccess = {
  request: {
    ...baseRequest,
    type: 'save' as const,
    dc: 12,
  },
  result: {
    total: 15,
    naturalRoll: 11,
    modifiers: 4,
  },
};

const mockRollFail = {
  request: {
    ...baseRequest,
    type: 'save' as const,
    dc: 12,
  },
  result: {
    total: 8,
    naturalRoll: 4,
    modifiers: 4,
  },
};

const mockRollNeutral = {
  request: {
    ...baseRequest,
    type: 'check' as const,
    ac: undefined,
    dc: undefined,
  },
  result: {
    total: 10,
    naturalRoll: 6,
    modifiers: 4,
  },
};

describe('NPCRollDisplay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('has accessible attributes and live regions', async () => {
    render(<NPCRollDisplay roll={mockRollHit as any} onDismiss={() => {}} />);

    const dialog = screen.getByRole('dialog', { name: 'Behind the DM Screen' });
    expect(dialog).toBeDefined();
    expect(screen.getByText('The Dungeon Master is resolving an NPC dice roll.')).toBeDefined();

    // Check for rolling status
    const rollingStatus = screen.getByLabelText('Rolling dice...');
    expect(rollingStatus).toBeDefined();

    // Fast forward past the roll animation (800ms)
    await act(async () => {
      vi.advanceTimersByTime(900);
    });

    // Check for final result status
    const finalResult = screen.getByLabelText('Result: 18');
    expect(finalResult).toBeDefined();

    // Check for formula aria-label
    const formula = screen.getByLabelText('Formula: 1d20+4');
    expect(formula).toBeDefined();

    // Check for status role for the HIT/MISS message
    const statusMessage = screen.getByText('HIT (AC 15)');
    const statusContainer = statusMessage.closest('[role="status"]');
    expect(statusContainer).toBeDefined();
    expect(statusContainer?.getAttribute('aria-live')).toBe('polite');

    // Check for the close button title and aria-label
    const closeButton = screen.getByRole('button', { name: /close behind the dm screen popup/i });
    expect(closeButton).toBeDefined();
  });

  it('displays MISS when roll is below AC', async () => {
    render(<NPCRollDisplay roll={mockRollMiss as any} onDismiss={() => {}} />);

    await act(async () => {
      vi.advanceTimersByTime(900);
    });

    expect(screen.getByText('MISS (AC 15)')).toBeDefined();
  });

  it('displays CRITICAL HIT! when critical is true', async () => {
    render(<NPCRollDisplay roll={mockRollCritical as any} onDismiss={() => {}} />);

    await act(async () => {
      vi.advanceTimersByTime(900);
    });

    expect(screen.getByText('CRITICAL HIT!')).toBeDefined();
  });

  it('displays Critical Fumble when natural roll is 1', async () => {
    render(<NPCRollDisplay roll={mockRollFumble as any} onDismiss={() => {}} />);

    await act(async () => {
      vi.advanceTimersByTime(900);
    });

    expect(screen.getByText('Critical Fumble')).toBeDefined();
  });

  it('displays SUCCESS when roll meets DC', async () => {
    render(<NPCRollDisplay roll={mockRollSuccess as any} onDismiss={() => {}} />);

    await act(async () => {
      vi.advanceTimersByTime(900);
    });

    expect(screen.getByText('SUCCESS (DC 12)')).toBeDefined();
  });

  it('displays FAIL when roll is below DC', async () => {
    render(<NPCRollDisplay roll={mockRollFail as any} onDismiss={() => {}} />);

    await act(async () => {
      vi.advanceTimersByTime(900);
    });

    expect(screen.getByText('FAIL (DC 12)')).toBeDefined();
  });

  it('displays neutral status when no AC or DC is provided', async () => {
    render(<NPCRollDisplay roll={mockRollNeutral as any} onDismiss={() => {}} />);

    await act(async () => {
      vi.advanceTimersByTime(900);
    });

    // Neutral status has empty text in config
    // We can check that no status message with background color is rendered,
    // or just that the component didn't crash and shows the result.
    expect(screen.getByLabelText('Result: 10')).toBeDefined();
  });

  it('calls onDismiss after autoDismissDelay', async () => {
    const onDismiss = vi.fn();
    render(
      <NPCRollDisplay roll={mockRollHit as any} onDismiss={onDismiss} autoDismissDelay={5000} />,
    );

    await act(async () => {
      vi.advanceTimersByTime(4900);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('clears timers on unmount', () => {
    const spy = vi.spyOn(global, 'clearTimeout');
    const { unmount } = render(<NPCRollDisplay roll={mockRollHit as any} onDismiss={() => {}} />);

    unmount();

    // It should clear both the auto-dismiss timer and the rolling animation timer
    expect(spy).toHaveBeenCalled();
  });

  it('does not dismiss when clicking the roll card', () => {
    const onDismiss = vi.fn();
    const { unmount } = render(<NPCRollDisplay roll={mockRollHit as any} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByText('BEHIND THE DM SCREEN'));
    expect(onDismiss).not.toHaveBeenCalled();
    unmount();
  });
});
