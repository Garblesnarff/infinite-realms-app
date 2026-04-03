/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePendingRolls, useLatestPendingRoll } from '../use-pending-rolls';
import { useMessageContext } from '@/contexts/MessageContext';

// Mock the MessageContext
vi.mock('@/contexts/MessageContext', () => ({
  useMessageContext: vi.fn(),
}));

describe('usePendingRolls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return no pending rolls when messages is empty', () => {
    (useMessageContext as any).mockReturnValue({ messages: [] });

    const { result } = renderHook(() => usePendingRolls());

    expect(result.current.hasPendingRolls).toBe(false);
    expect(result.current.pendingRequests).toHaveLength(0);
    expect(result.current.lastDMMessage).toBeNull();
  });

  it('should return no pending rolls when there are no DM messages', () => {
    const messages = [
      { sender: 'player', text: 'Hello' },
      { sender: 'system', text: 'System message' },
    ];
    (useMessageContext as any).mockReturnValue({ messages });

    const { result } = renderHook(() => usePendingRolls());

    expect(result.current.hasPendingRolls).toBe(false);
    expect(result.current.lastDMMessage).toBeNull();
  });

  it('should detect pending rolls from DM message', () => {
    const messages = [
      { sender: 'player', text: 'I open the door' },
      { sender: 'dm', text: 'Make a Perception check (DC 15)' },
    ];
    (useMessageContext as any).mockReturnValue({ messages });

    const { result } = renderHook(() => usePendingRolls());

    expect(result.current.hasPendingRolls).toBe(true);
    expect(result.current.pendingRequests).toHaveLength(1);
    expect(result.current.pendingRequests[0].type).toBe('skill_check');
    expect(result.current.pendingRequests[0].purpose).toBe('Perception check');
    expect(result.current.lastDMMessage).toEqual(messages[1]);
  });

  it('should resolve pending rolls when player responds with a dice roll', () => {
    const messages = [
      { sender: 'dm', text: 'Make a Perception check' },
      { sender: 'player', text: 'Perception: 18 ✓' },
    ];
    (useMessageContext as any).mockReturnValue({ messages });

    const { result } = renderHook(() => usePendingRolls());

    expect(result.current.hasPendingRolls).toBe(false);
  });

  it('should recognize different dice roll patterns in player messages', () => {
    const patterns = [
      'Perception: 15 ✓',
      'Investigation: 7 ✗',
      'I rolled 15',
      'rolled a 20',
      '18 ✓',
    ];

    patterns.forEach((pattern) => {
      const messages = [
        { sender: 'dm', text: 'Make a check' },
        { sender: 'player', text: pattern },
      ];
      (useMessageContext as any).mockReturnValue({ messages });

      const { result } = renderHook(() => usePendingRolls());
      expect(result.current.hasPendingRolls).toBe(false);
    });
  });

  it('should still be pending if player responds with non-roll message', () => {
    const messages = [
      { sender: 'dm', text: 'Make a Perception check' },
      { sender: 'player', text: 'Wait, what was that?' },
    ];
    (useMessageContext as any).mockReturnValue({ messages });

    const { result } = renderHook(() => usePendingRolls());

    expect(result.current.hasPendingRolls).toBe(true);
  });

  it('should mitigate bug when DM requests roll immediately after player rolled', () => {
    // Scenario:
    // 1. DM: "Roll initiative"
    // 2. Player: "rolled 18"
    // 3. DM (buggy): "Please roll initiative" (again)
    const messages = [
      { sender: 'dm', text: 'Roll initiative' },
      { sender: 'player', text: 'rolled 18' },
      { sender: 'dm', text: 'Please roll initiative' },
    ];
    (useMessageContext as any).mockReturnValue({ messages });

    const { result } = renderHook(() => usePendingRolls());

    // Should be suppressed because last player message was a dice roll
    expect(result.current.hasPendingRolls).toBe(false);
  });

  it('should detect rolls from context intent', () => {
    const messages = [
      { sender: 'dm', text: 'Make a check' },
      { sender: 'player', text: 'I do it', context: { intent: 'dice_roll' } },
    ];
    (useMessageContext as any).mockReturnValue({ messages });

    const { result } = renderHook(() => usePendingRolls());

    expect(result.current.hasPendingRolls).toBe(false);
  });
});

describe('useLatestPendingRoll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return the latest pending roll', () => {
    const messages = [{ sender: 'dm', text: 'Make a Perception check and an Athletics check' }];
    (useMessageContext as any).mockReturnValue({ messages });

    const { result } = renderHook(() => useLatestPendingRoll());

    expect(result.current.hasLatestPendingRoll).toBe(true);
    expect(result.current.latestPendingRoll).not.toBeNull();
    // parseRollRequests should find both, we expect the first one
    expect(result.current.latestPendingRoll?.purpose).toContain('Perception');
  });

  it('should return null when there are no pending rolls', () => {
    (useMessageContext as any).mockReturnValue({ messages: [] });

    const { result } = renderHook(() => useLatestPendingRoll());

    expect(result.current.hasLatestPendingRoll).toBe(false);
    expect(result.current.latestPendingRoll).toBeNull();
  });
});
