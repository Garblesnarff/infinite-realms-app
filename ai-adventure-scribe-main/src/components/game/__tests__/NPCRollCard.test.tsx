/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { expect, vi, describe, it, beforeEach, afterEach } from 'vitest';

import { NPCRollCard } from '../NPCRollCard';

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

describe('NPCRollCard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders and displays roll result after animation', async () => {
    render(<NPCRollCard roll={mockRollHit as any} onDismiss={() => {}} />);

    // Initially shows rolling status
    expect(screen.getByLabelText('Rolling dice...')).toBeDefined();

    // Fast forward past the roll animation (800ms)
    await act(async () => {
      vi.advanceTimersByTime(850);
    });

    expect(screen.getByLabelText('Result: 18')).toBeDefined();
    expect(screen.getByText('HIT (AC 15)')).toBeDefined();
    expect(screen.getByText('Goblins')).toBeDefined();
    expect(screen.getByText('Attack player')).toBeDefined();
  });

  it('displays MISS when roll is below AC', async () => {
    render(<NPCRollCard roll={mockRollMiss as any} onDismiss={() => {}} />);

    await act(async () => {
      vi.advanceTimersByTime(850);
    });

    expect(screen.getByText('MISS (AC 15)')).toBeDefined();
  });

  it('displays CRITICAL HIT! when critical is true', async () => {
    render(<NPCRollCard roll={mockRollCritical as any} onDismiss={() => {}} />);

    await act(async () => {
      vi.advanceTimersByTime(850);
    });

    expect(screen.getByText('CRITICAL HIT!')).toBeDefined();
  });

  it('displays Critical Fumble when natural roll is 1', async () => {
    render(<NPCRollCard roll={mockRollFumble as any} onDismiss={() => {}} />);

    await act(async () => {
      vi.advanceTimersByTime(850);
    });

    expect(screen.getByText('Critical Fumble')).toBeDefined();
  });

  it('displays SUCCESS when roll meets DC', async () => {
    render(<NPCRollCard roll={mockRollSuccess as any} onDismiss={() => {}} />);

    await act(async () => {
      vi.advanceTimersByTime(850);
    });

    expect(screen.getByText('SUCCESS (DC 12)')).toBeDefined();
  });

  it('displays FAIL when roll is below DC', async () => {
    render(<NPCRollCard roll={mockRollFail as any} onDismiss={() => {}} />);

    await act(async () => {
      vi.advanceTimersByTime(850);
    });

    expect(screen.getByText('FAIL (DC 12)')).toBeDefined();
  });

  it('calls onDismiss after autoDismissDelay', async () => {
    const onDismiss = vi.fn();
    render(<NPCRollCard roll={mockRollHit as any} onDismiss={onDismiss} autoDismissDelay={5000} />);

    await act(async () => {
      vi.advanceTimersByTime(4900);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('calls onDismiss when clicking the close button', () => {
    const onDismiss = vi.fn();
    render(<NPCRollCard roll={mockRollHit as any} onDismiss={onDismiss} />);

    const closeButton = screen.getByRole('button', { name: /close behind the dm screen popup/i });
    closeButton.click();

    expect(onDismiss).toHaveBeenCalled();
  });
});
