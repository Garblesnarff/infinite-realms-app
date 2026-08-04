/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

  // Regression tests for #1658: "Phantom roll request from option text disables the chat input"
  //
  // The prose regex parser must never see the trailing lettered/numbered action options of a DM
  // message. Combat-shaped language inside an option's description (e.g. "make an attack roll")
  // used to be read as a real roll request, which flipped hasPendingRolls to true with no dice
  // dialog ever shown, permanently disabling ChatInput.
  it('does not raise a phantom pending roll when only action options mention combat verbs (#1658)', () => {
    const messages = [
      { sender: 'player', text: 'I look around the kitchen.' },
      {
        sender: 'dm',
        text: `The kitchen erupts in flame as Balthazar's rage boils over.

A. **Wield the shimmering cleaver**, grab the blade to stabilize the chaotic energy, confront Balthazar, and make an attack roll against his guard.
B. **Command the imps**, use your presence to restore order and force the creatures to cease their destruction.
C. **Douse Balthazar's flames**, use a nearby ingredient or spell to quench his fury before the kitchen collapses.`,
      },
    ];
    (useMessageContext as any).mockReturnValue({ messages });

    const { result } = renderHook(() => usePendingRolls());

    expect(result.current.hasPendingRolls).toBe(false);
    expect(result.current.pendingRequests).toHaveLength(0);
  });

  it('shows the pending-roll banner when the DM message carries a genuine structured roll request', () => {
    const messages = [
      { sender: 'player', text: 'I raise my blade toward the guard.' },
      {
        sender: 'dm',
        text: 'The guard raises their shield to meet your strike.',
        rollRequests: [{ type: 'attack', formula: '1d20+modifier', purpose: 'Attack roll' }],
      },
    ];
    (useMessageContext as any).mockReturnValue({ messages });

    const { result } = renderHook(() => usePendingRolls());

    expect(result.current.hasPendingRolls).toBe(true);
    expect(result.current.pendingRequests).toHaveLength(1);
    expect(result.current.pendingRequests[0].type).toBe('attack');
  });

  it('trusts an empty structured rollRequests array instead of falling back to text parsing', () => {
    const messages = [
      { sender: 'player', text: 'I ready my weapon.' },
      {
        sender: 'dm',
        text: 'Make an attack roll against the bandit.',
        rollRequests: [],
      },
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
