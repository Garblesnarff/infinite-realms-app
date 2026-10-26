import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useCombatLegalActions } from '../use-combat-legal-actions';

const combatHolder = vi.hoisted(() => ({
  current: {
    state: {
      isInCombat: true,
      activeEncounter: {
        id: 'enc-1',
        currentTurnParticipantId: 'pc-1',
        currentRound: 1,
        participants: [{ id: 'pc-1', participantType: 'player' }],
      },
    },
    refreshCombatState: vi.fn(),
  },
}));

vi.mock('@/contexts/CombatContext', () => ({
  useCombat: () => combatHolder.current,
  useOptionalCombat: () => combatHolder.current,
}));

describe('useCombatLegalActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('a failed refresh clears previously loaded actions and a successful retry restores them', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ actorId: 'pc-1', actions: [{ type: 'attack', label: 'Attack' }] }),
      } as Response)
      .mockResolvedValueOnce({ ok: false, status: 500 } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ actorId: 'pc-1', actions: [{ type: 'attack', label: 'Attack' }] }),
      } as Response);

    const { result } = renderHook(() =>
      useCombatLegalActions({ enabled: true, onSendText: vi.fn() }),
    );

    await waitFor(() => expect(result.current.actions).toHaveLength(1));

    await act(async () => {
      await result.current.retryLoad();
    });
    await waitFor(() => expect(result.current.actions).toEqual([]));

    await act(async () => {
      await result.current.retryLoad();
    });
    await waitFor(() => expect(result.current.actions).toHaveLength(1));

    expect(fetchSpy).toHaveBeenCalled();
  });
});
