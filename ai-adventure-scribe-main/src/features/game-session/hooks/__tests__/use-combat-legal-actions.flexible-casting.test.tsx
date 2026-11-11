import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest';

import { flexibleCastingIntentBody } from '../../../../../shared/test-fixtures/flexible-casting-intent';
import { useCombatLegalActions } from '../use-combat-legal-actions';

import type { ChatMessage } from '@/types/game';

vi.mock('@/services/combat/player-roll-bridge', () => ({
  requestPlayerAttackRoll: vi.fn(),
}));
vi.mock('@/services/combat/spell-target-save-bridge', () => ({
  requestSpellTargetSave: vi.fn(),
}));

const inspirationHolder = vi.hoisted(() => ({
  armed: false,
  arm: vi.fn(),
  disarm: vi.fn(),
  spendInspiration: vi.fn(async () => true),
}));
vi.mock('@/features/game-session/hooks/use-inspiration-spend', () => ({
  useInspirationSpend: () => ({
    armed: inspirationHolder.armed,
    arm: (...args: unknown[]) => {
      inspirationHolder.arm(...args);
      inspirationHolder.armed = true;
    },
    disarm: (...args: unknown[]) => {
      inspirationHolder.disarm(...args);
      inspirationHolder.armed = false;
    },
    spendInspiration: inspirationHolder.spendInspiration,
  }),
}));
// #1414 round 4 (CI fix): useCombatLegalActions reads the armed state straight from
// the armed context now (it never spends), so the chip tests mock that hook. The
// useInspirationSpend mock above stays as the B2 tripwire: if a spend ever creeps
// back into runAction, the mock is wired up again and the no-spend tests catch it.
vi.mock('@/features/game-session/contexts/inspiration-armed-context', () => ({
  useInspirationArmed: () => ({
    armed: inspirationHolder.armed,
    arm: (...args: unknown[]) => {
      inspirationHolder.arm(...args);
      inspirationHolder.armed = true;
    },
    disarm: (...args: unknown[]) => {
      inspirationHolder.disarm(...args);
      inspirationHolder.armed = false;
    },
  }),
}));

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

const movementHolder = vi.hoisted(() => ({
  remaining: vi.fn(async () => 0),
}));

vi.mock('@/services/combat/player-movement-remaining', () => ({
  actorMovementRemaining: movementHolder.remaining,
}));

/**
 * #1233: Flexible Casting from the bar. The chip posts the `flexible_casting` intent with the
 * direction and slot level the engine named; the bonus action is the only cost, so the turn stays
 * open (no end_turn), and the engine's line goes to the notice.
 */
describe('useCombatLegalActions flexible_casting (#1233)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    movementHolder.remaining.mockResolvedValue(5);
  });

  const convertAction = {
    type: 'flexible_casting',
    label: 'Convert a 1st-level slot into 1 sorcery point',
    direction: 'convert',
    slotLevel: 1,
    pointsGained: 1,
  };
  const createAction = {
    type: 'flexible_casting',
    label: 'Create a 2nd-level slot (3 sorcery points)',
    direction: 'create',
    slotLevel: 2,
    pointsCost: 3,
  };

  function routeFetch(action: Record<string, unknown>): MockInstance<typeof fetch> {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: unknown) => {
      const href = String(url);
      if (href.includes('/legal-actions')) {
        return { ok: true, json: async () => ({ actorId: 'pc-1', actions: [action] }) } as Response;
      }
      if (href.includes('/status')) {
        return { ok: true, json: async () => ({ encounter: { version: 7 } }) } as Response;
      }
      if (href.includes('/intent')) {
        return { ok: true, json: async () => ({ accepted: true, result: {} }) } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });
  }

  interface IntentCallBody {
    intent: Record<string, unknown> & { type: string };
    source?: string;
  }

  function intentCalls(
    fetchSpy: ReturnType<typeof routeFetch>,
  ): Array<{ url: string; body: IntentCallBody }> {
    return fetchSpy.mock.calls
      .map(([url, init]) => ({
        url: String(url),
        body: JSON.parse(String((init as { body?: string }).body ?? '{}')),
      }))
      .filter((call) => call.url.includes('/intent'));
  }

  it('posts a convert intent with the engine slot level and ends no turn', async () => {
    const fetchSpy = routeFetch(convertAction);
    const onSendMessage = vi.fn(async (_message: ChatMessage) => {});
    const { result } = renderHook(() =>
      useCombatLegalActions({ enabled: true, onSendMessage, onSendText: vi.fn() }),
    );

    await waitFor(() => expect(result.current.actions).toHaveLength(1));

    await act(async () => {
      await result.current.runAction(convertAction as never);
    });

    const intents = intentCalls(fetchSpy);
    expect(intents).toHaveLength(1);
    // The posted body is the shared wire fixture (the real-route test posts the same one).
    expect(intents[0].body).toMatchObject(flexibleCastingIntentBody('convert', 1, 'pc-1', 7));
    expect(intents.some((call) => call.body.intent.type === 'end_turn')).toBe(false);
    expect(combatHolder.current.refreshCombatState).toHaveBeenCalled();
  });

  it('posts a create intent with the option the table names', async () => {
    const fetchSpy = routeFetch(createAction);
    const { result } = renderHook(() =>
      useCombatLegalActions({ enabled: true, onSendMessage: vi.fn(), onSendText: vi.fn() }),
    );

    await waitFor(() => expect(result.current.actions).toHaveLength(1));

    await act(async () => {
      await result.current.runAction(createAction as never);
    });

    const intents = intentCalls(fetchSpy);
    expect(intents).toHaveLength(1);
    expect(intents[0].body).toMatchObject(flexibleCastingIntentBody('create', 2, 'pc-1', 7));
  });

  it('refuses without sending when the option names no direction or level', async () => {
    const fetchSpy = routeFetch(convertAction);
    const { result } = renderHook(() =>
      useCombatLegalActions({ enabled: true, onSendMessage: vi.fn(), onSendText: vi.fn() }),
    );

    await waitFor(() => expect(result.current.actions).toHaveLength(1));

    await act(async () => {
      await result.current.runAction({
        type: 'flexible_casting',
        label: 'Flexible Casting',
      } as never);
    });

    expect(intentCalls(fetchSpy)).toHaveLength(0);
    expect(result.current.error).toBe('That option could not be used. Nothing was spent.');
  });
});
