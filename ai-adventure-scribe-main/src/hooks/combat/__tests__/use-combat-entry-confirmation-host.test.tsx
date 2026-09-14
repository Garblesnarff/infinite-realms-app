import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useCombatEntryConfirmationHost } from '../use-combat-entry-confirmation-host';

import {
  hasPendingCombatEntryConfirmation,
  requestCombatEntryConfirmation,
  setCombatEntryConfirmationHost,
  settlePendingCombatEntryConfirmation,
} from '@/services/combat/combat-entry-confirmation-bridge';

const SPEC = {
  actorLabel: 'The Storyteller',
  combatantLabels: ['Vance'],
  initiativeRoll: null,
  initiativeModifier: 2,
};

describe('useCombatEntryConfirmationHost teardown', () => {
  beforeEach(() => {
    settlePendingCombatEntryConfirmation(false);
    setCombatEntryConfirmationHost(null);
  });

  afterEach(() => {
    settlePendingCombatEntryConfirmation(false);
    setCombatEntryConfirmationHost(null);
  });

  it('keeps a pending confirmation alive across a same-session remount', async () => {
    const first = renderHook(() => useCombatEntryConfirmationHost('session-1'));
    const pending = requestCombatEntryConfirmation(SPEC);

    first.unmount();
    const second = renderHook(() => useCombatEntryConfirmationHost('session-1'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(hasPendingCombatEntryConfirmation()).toBe(true);
    act(() => {
      expect(settlePendingCombatEntryConfirmation(true)).toBe(true);
    });
    await expect(pending).resolves.toBe(true);
    second.unmount();
  });

  it('declines a pending confirmation when the host really tears down', async () => {
    const { unmount } = renderHook(() => useCombatEntryConfirmationHost('session-1'));
    const pending = requestCombatEntryConfirmation(SPEC);

    unmount();
    await expect(pending).resolves.toBe(false);
    expect(hasPendingCombatEntryConfirmation()).toBe(false);
  });
});
