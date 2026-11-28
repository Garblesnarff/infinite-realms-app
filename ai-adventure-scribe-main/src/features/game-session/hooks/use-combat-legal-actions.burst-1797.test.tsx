/** #1797: the weapon list is read once per burst of map changes, not once per change. */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCombatLegalActions } from './use-combat-legal-actions';

const state = vi.hoisted(() => ({ fetches: 0 }));

vi.mock('@/contexts/CombatContext', () => ({
  useCombat: () => ({
    state: {
      isInCombat: true,
      activeEncounter: {
        id: 'enc-1',
        currentTurnParticipantId: 'pc-1',
        currentRound: 1,
        participants: [{ id: 'pc-1', participantType: 'player', isActive: true, name: 'Hero' }],
      },
    },
    refreshCombatState: vi.fn(),
  }),
}));
vi.mock('@/features/game-session/contexts/inspiration-armed-context', () => ({
  useInspirationArmed: () => ({ armed: false, arm: vi.fn(), disarm: vi.fn() }),
}));
vi.mock('@/infrastructure/api/rest-client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchWithAuth: vi.fn(async (path: string) => {
    if (path.includes('/legal-actions')) state.fetches += 1;
    return new Response(JSON.stringify({ actorId: 'pc-1', actions: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }),
}));

const delta = (): void => {
  window.dispatchEvent(
    new CustomEvent('tactical-map-delta', {
      detail: {
        type: 'entity_moved',
        entityId: 'foe-1',
        path: [
          { x: 1, y: 1 },
          { x: 2, y: 1 },
        ],
      },
    }),
  );
};

beforeEach(() => {
  vi.useFakeTimers();
  state.fetches = 0;
});
afterEach(() => vi.useRealTimers());

describe('useCombatLegalActions board changes (#1797)', () => {
  it('five map changes in a row read the weapon list at most twice more', async () => {
    renderHook(() => useCombatLegalActions({ enabled: true, onSendText: async () => {} }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const before = state.fetches;
    expect(before).toBeGreaterThanOrEqual(1);

    act(() => {
      for (let i = 0; i < 5; i++) delta();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(state.fetches - before).toBeLessThanOrEqual(2);
    expect(state.fetches - before).toBeGreaterThanOrEqual(1);
  });
});
