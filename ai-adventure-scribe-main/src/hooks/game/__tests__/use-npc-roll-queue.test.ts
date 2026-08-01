/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { useNPCRollQueue } from '../use-npc-roll-queue';

const baseRequest = {
  actorName: 'Goblins',
  purpose: 'Attack player',
  type: 'attack' as const,
  formula: '1d20+4',
  ac: 15,
};

const mockRoll1 = {
  request: baseRequest,
  result: {
    total: 18,
    naturalRoll: 14,
    modifiers: 4,
  },
  timestamp: new Date(),
};

const mockRoll2 = {
  request: baseRequest,
  result: {
    total: 10,
    naturalRoll: 6,
    modifiers: 4,
  },
  timestamp: new Date(),
};

describe('useNPCRollQueue', () => {
  it('initializes with empty queue', () => {
    const { result } = renderHook(() => useNPCRollQueue());
    expect(result.current.currentRoll).toBeNull();
    expect(result.current.queueLength).toBe(0);
  });

  it('adds rolls to the queue and sets the first one as current', () => {
    const { result } = renderHook(() => useNPCRollQueue());

    act(() => {
      result.current.addRolls([mockRoll1 as any]);
    });

    expect(result.current.currentRoll).toEqual(mockRoll1);
    expect(result.current.queueLength).toBe(0);
  });

  it('handles multiple rolls in the queue', () => {
    const { result } = renderHook(() => useNPCRollQueue());

    act(() => {
      result.current.addRolls([mockRoll1 as any, mockRoll2 as any]);
    });

    // First roll becomes current, second stays in queue
    expect(result.current.currentRoll).toEqual(mockRoll1);
    expect(result.current.queueLength).toBe(1);
  });

  it('moves to the next roll when current is dismissed', () => {
    const { result } = renderHook(() => useNPCRollQueue());

    act(() => {
      result.current.addRolls([mockRoll1 as any, mockRoll2 as any]);
    });

    expect(result.current.currentRoll).toEqual(mockRoll1);

    act(() => {
      result.current.dismissCurrent();
    });

    // currentRoll should be null temporarily, then useEffect should set it to mockRoll2
    expect(result.current.currentRoll).toEqual(mockRoll2);
    expect(result.current.queueLength).toBe(0);
  });

  it('becomes null when the last roll is dismissed', () => {
    const { result } = renderHook(() => useNPCRollQueue());

    act(() => {
      result.current.addRolls([mockRoll1 as any]);
    });

    act(() => {
      result.current.dismissCurrent();
    });

    expect(result.current.currentRoll).toBeNull();
    expect(result.current.queueLength).toBe(0);
  });

  it('maintains stable callback identities', () => {
    const { result, rerender } = renderHook(() => useNPCRollQueue());
    const initialAddRolls = result.current.addRolls;
    const initialDismissCurrent = result.current.dismissCurrent;

    rerender();

    expect(result.current.addRolls).toBe(initialAddRolls);
    expect(result.current.dismissCurrent).toBe(initialDismissCurrent);
  });

  it('maintains referential stability for the returned object', () => {
    const { result, rerender } = renderHook(() => useNPCRollQueue());
    const initialRef = result.current;

    rerender();

    expect(result.current).toBe(initialRef);
  });
});
