import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest';

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

/** The engine's heal result for Lay on Hands (`resolveLayOnHands`, paladin-features-service.ts). */
const HEAL_RESULT = {
  ok: true,
  healed: 3,
  poolRemaining: 12,
  poolMax: 15,
  message: 'The Scholar lays on hands and restores 3 HP to themself. Pool: 12 of 15 HP remaining.',
};

/** The engine's cure result: no HP, the disease or poison named, the pool drawn for it. */
const CURE_RESULT = {
  ok: true,
  healed: 0,
  poolRemaining: 10,
  poolMax: 15,
  cured: 'poison',
  message: 'The Scholar lays on hands and neutralizes the poison. Pool: 10 of 15 HP remaining.',
};

/**
 * #1618: the Lay on Hands chip spends the Action and must print the engine's line. Before the
 * fix the formatter returned no line for this action, so the chip healed and posted nothing.
 */
describe('useCombatLegalActions lay_on_hands (#1618)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    movementHolder.remaining.mockResolvedValue(5);
  });

  const healAction = {
    type: 'lay_on_hands',
    label: 'Lay on Hands: heal 3 HP (self)',
    targetId: 'pc-1',
    amount: 3,
  };
  const cureAction = {
    type: 'lay_on_hands',
    label: 'Lay on Hands: cure poison (5 points)',
    targetId: 'pc-1',
    cure: 'poison',
  };

  function routeFetch(
    action: Record<string, unknown>,
    result: unknown,
  ): MockInstance<typeof fetch> {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: unknown) => {
      const href = String(url);
      if (href.includes('/legal-actions')) {
        return { ok: true, json: async () => ({ actorId: 'pc-1', actions: [action] }) } as Response;
      }
      if (href.includes('/status')) {
        return { ok: true, json: async () => ({ encounter: { version: 7 } }) } as Response;
      }
      if (href.includes('/intent')) {
        return { ok: true, json: async () => ({ accepted: true, result }) } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });
  }

  interface IntentCallBody {
    intent: Record<string, unknown> & { type: string };
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

  it('posts a system message carrying the engine line when the heal chip fires', async () => {
    const fetchSpy = routeFetch(healAction, HEAL_RESULT);
    const onSendMessage = vi.fn(async (_message: ChatMessage) => {});
    const { result } = renderHook(() =>
      useCombatLegalActions({ enabled: true, onSendMessage, onSendText: vi.fn() }),
    );

    await waitFor(() => expect(result.current.actions).toHaveLength(1));

    await act(async () => {
      await result.current.runAction(healAction as never);
    });

    const intents = intentCalls(fetchSpy);
    expect(intents).toHaveLength(1);
    expect(intents[0].body.intent).toMatchObject({
      type: 'lay_on_hands',
      actorId: 'pc-1',
      targetId: 'pc-1',
      amount: 3,
    });

    expect(onSendMessage).toHaveBeenCalledTimes(1);
    const [message] = onSendMessage.mock.calls[0];
    expect(message.sender).toBe('system');
    expect(message.text).toContain('used Lay on Hands');
    expect(message.text).toContain(HEAL_RESULT.message);
    expect(message.context?.engineCards).toHaveLength(1);
  });

  it('posts a system message carrying the engine line when the cure chip fires', async () => {
    routeFetch(cureAction, CURE_RESULT);
    const onSendMessage = vi.fn(async (_message: ChatMessage) => {});
    const { result } = renderHook(() =>
      useCombatLegalActions({ enabled: true, onSendMessage, onSendText: vi.fn() }),
    );

    await waitFor(() => expect(result.current.actions).toHaveLength(1));

    await act(async () => {
      await result.current.runAction(cureAction as never);
    });

    expect(onSendMessage).toHaveBeenCalledTimes(1);
    const [message] = onSendMessage.mock.calls[0];
    expect(message.sender).toBe('system');
    expect(message.text).toContain('neutralizes the poison');
    expect(message.text).toContain('Pool: 10 of 15 HP remaining.');
  });
});

/**
 * #1670: the engine's pool number reaches the in-game sheet panel at once, and a heal can carry the
 * amount the player chose in the More stepper.
 */
describe('useCombatLegalActions pool numbers (#1670)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    movementHolder.remaining.mockResolvedValue(5);
  });

  const routeFetchFor = (action: Record<string, unknown>, result: unknown) =>
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: unknown) => {
      const href = String(url);
      if (href.includes('/legal-actions')) {
        return { ok: true, json: async () => ({ actorId: 'pc-1', actions: [action] }) } as Response;
      }
      if (href.includes('/status')) {
        return { ok: true, json: async () => ({ encounter: { version: 7 } }) } as Response;
      }
      if (href.includes('/intent')) {
        return { ok: true, json: async () => ({ accepted: true, result }) } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });

  it('a heal publishes the engine pool to the sheet panel with its maximum', async () => {
    routeFetchFor(
      { type: 'lay_on_hands', label: 'Lay on Hands', targetId: 'pc-1', amount: 3 },
      {
        ok: true,
        healed: 3,
        poolRemaining: 12,
        poolMax: 15,
        message: 'Pool: 12 of 15 HP remaining.',
      },
    );
    const published: unknown[] = [];
    const listener = (event: Event) => published.push((event as CustomEvent).detail);
    window.addEventListener('character-pool-updated', listener);
    try {
      const { result } = renderHook(() =>
        useCombatLegalActions({ enabled: true, onSendMessage: vi.fn(), onSendText: vi.fn() }),
      );
      await waitFor(() => expect(result.current.actions).toHaveLength(1));
      await act(async () => {
        await result.current.runAction({
          type: 'lay_on_hands',
          label: 'Lay on Hands',
          targetId: 'pc-1',
          amount: 3,
        } as never);
      });
      expect(published).toEqual([{ feature: 'lay_on_hands', currentUses: 12, maxUses: 15 }]);
    } finally {
      window.removeEventListener('character-pool-updated', listener);
    }
  });

  it('a heal with a chosen amount sends that amount, not the chip default', async () => {
    const fetchSpy = routeFetchFor(
      { type: 'lay_on_hands', label: 'Lay on Hands', targetId: 'pc-1', amount: 5, maxAmount: 5 },
      {
        ok: true,
        healed: 3,
        poolRemaining: 12,
        poolMax: 15,
        message: 'Pool: 12 of 15 HP remaining.',
      },
    );
    const { result } = renderHook(() =>
      useCombatLegalActions({ enabled: true, onSendMessage: vi.fn(), onSendText: vi.fn() }),
    );
    await waitFor(() => expect(result.current.actions).toHaveLength(1));
    await act(async () => {
      await result.current.runAction({
        type: 'lay_on_hands',
        label: 'Lay on Hands',
        targetId: 'pc-1',
        amount: 3,
        maxAmount: 5,
      } as never);
    });
    const intentCall = fetchSpy.mock.calls.find(([url]) => String(url).includes('/intent'));
    const body = JSON.parse(String((intentCall?.[1] as { body?: string }).body ?? '{}'));
    expect(body.intent).toMatchObject({ type: 'lay_on_hands', targetId: 'pc-1', amount: 3 });
  });

  it('Second Wind publishes the engine use count', async () => {
    routeFetchFor(
      { type: 'second_wind', label: 'Second Wind' },
      {
        applied: true,
        action: 'second_wind',
        roll: 6,
        healed: 8,
        newHp: 15,
        maxHp: 15,
        usesRemaining: 0,
      },
    );
    const published: unknown[] = [];
    const listener = (event: Event) => published.push((event as CustomEvent).detail);
    window.addEventListener('character-pool-updated', listener);
    try {
      const { result } = renderHook(() =>
        useCombatLegalActions({ enabled: true, onSendMessage: vi.fn(), onSendText: vi.fn() }),
      );
      await waitFor(() => expect(result.current.actions).toHaveLength(1));
      await act(async () => {
        await result.current.runAction({ type: 'second_wind', label: 'Second Wind' } as never);
      });
      expect(published).toEqual([{ feature: 'second_wind', currentUses: 0 }]);
    } finally {
      window.removeEventListener('character-pool-updated', listener);
    }
  });

  // #1679: Action Surge publishes its engine use count, as Second Wind does.
  it('Action Surge publishes the engine use count', async () => {
    routeFetchFor(
      { type: 'action_surge', label: 'Action Surge' },
      { applied: true, action: 'action_surge', usesRemaining: 0 },
    );
    const published: unknown[] = [];
    const listener = (event: Event): void => {
      published.push((event as CustomEvent).detail);
    };
    window.addEventListener('character-pool-updated', listener);
    try {
      const { result } = renderHook(() =>
        useCombatLegalActions({ enabled: true, onSendMessage: vi.fn(), onSendText: vi.fn() }),
      );
      await waitFor(() => expect(result.current.actions).toHaveLength(1));
      await act(async () => {
        await result.current.runAction({ type: 'action_surge', label: 'Action Surge' } as never);
      });
      expect(published).toEqual([{ feature: 'action_surge', currentUses: 0 }]);
    } finally {
      window.removeEventListener('character-pool-updated', listener);
    }
  });

  // #1679: Rage publishes the engine's remaining rage uses from the rage result, like the others.
  it('Rage publishes the engine use count from the rage result', async () => {
    routeFetchFor({ type: 'rage', label: 'Rage' }, { usesRemaining: 2, expiresRound: 4 });
    const published: unknown[] = [];
    const listener = (event: Event): void => {
      published.push((event as CustomEvent).detail);
    };
    window.addEventListener('character-pool-updated', listener);
    try {
      const { result } = renderHook(() =>
        useCombatLegalActions({ enabled: true, onSendMessage: vi.fn(), onSendText: vi.fn() }),
      );
      await waitFor(() => expect(result.current.actions).toHaveLength(1));
      await act(async () => {
        await result.current.runAction({ type: 'rage', label: 'Rage' } as never);
      });
      expect(published).toEqual([{ feature: 'rage', currentUses: 2 }]);
    } finally {
      window.removeEventListener('character-pool-updated', listener);
    }
  });
});
