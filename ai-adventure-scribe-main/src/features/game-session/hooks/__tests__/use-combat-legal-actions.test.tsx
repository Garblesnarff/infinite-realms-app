import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest';

import { useCombatLegalActions } from '../use-combat-legal-actions';

import type { ChatMessage } from '@/types/game';

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

describe('useCombatLegalActions use_item (#1147)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  const useItemAction = { type: 'use_item', label: 'Use Potion of Healing', itemId: 'potion-1' };

  function routeFetch(): MockInstance<typeof fetch> {
    return vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (url: unknown, init?: unknown) => {
        const href = String(url);
        if (href.includes('/legal-actions')) {
          return {
            ok: true,
            json: async () => ({ actorId: 'pc-1', actions: [useItemAction] }),
          } as Response;
        }
        if (href.includes('/intent')) {
          const body = JSON.parse(String((init as { body?: string }).body ?? '{}')) as {
            intent?: { type?: string };
          };
          if (body.intent?.type === 'use_item') {
            return {
              ok: true,
              json: async () => ({
                accepted: true,
                result: {
                  itemName: 'Potion of Healing',
                  healed: 9,
                  newHp: 18,
                  maxHp: 20,
                },
              }),
            } as Response;
          }
          return { ok: true, json: async () => ({ accepted: true, result: {} }) } as Response;
        }
        return { ok: false, status: 404 } as Response;
      });
  }

  interface IntentCallBody {
    intent: { type: string; actorId?: string; itemId?: string; actionId?: string };
    source?: string;
    dmStartedAt?: number;
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

  it('posts use_item, sends the engine notice, and ends the turn when movement is exhausted', async () => {
    movementHolder.remaining.mockResolvedValue(0);
    const fetchSpy = routeFetch();
    const onSendMessage = vi.fn(async (_message: ChatMessage) => {});
    const { result } = renderHook(() =>
      useCombatLegalActions({ enabled: true, onSendMessage, onSendText: vi.fn() }),
    );

    await waitFor(() => expect(result.current.actions).toHaveLength(1));

    await act(async () => {
      await result.current.runAction(useItemAction as never);
    });

    const intents = intentCalls(fetchSpy);
    expect(intents).toHaveLength(2);
    expect(intents[0].body.intent).toEqual({
      type: 'use_item',
      actorId: 'pc-1',
      itemId: 'potion-1',
    });
    expect(intents[0].body.source).toBe('dm');
    expect(intents[1].body.intent.type).toBe('end_turn');
    expect(onSendMessage).toHaveBeenCalled();
    const notice = onSendMessage.mock.calls[0][0];
    expect(notice.text).toContain('Potion of Healing');
    expect(notice.text).toContain('9 HP');
    expect(combatHolder.current.refreshCombatState).toHaveBeenCalled();
  });

  it('does not end the turn when movement remains', async () => {
    movementHolder.remaining.mockResolvedValue(5);
    const fetchSpy = routeFetch();
    const onSendMessage = vi.fn(async (_message: ChatMessage) => {});
    const { result } = renderHook(() =>
      useCombatLegalActions({ enabled: true, onSendMessage, onSendText: vi.fn() }),
    );

    await waitFor(() => expect(result.current.actions).toHaveLength(1));

    await act(async () => {
      await result.current.runAction(useItemAction as never);
    });

    const intents = intentCalls(fetchSpy);
    expect(intents).toHaveLength(1);
    expect(intents[0].body.intent.type).toBe('use_item');
    expect(onSendMessage).toHaveBeenCalled();
  });

  it('refuses without sending when the action carries no itemId', async () => {
    const fetchSpy = routeFetch();
    const { result } = renderHook(() =>
      useCombatLegalActions({ enabled: true, onSendMessage: vi.fn(), onSendText: vi.fn() }),
    );

    await waitFor(() => expect(result.current.actions).toHaveLength(1));

    await act(async () => {
      await result.current.runAction({ type: 'use_item', label: 'Use item' } as never);
    });

    expect(intentCalls(fetchSpy)).toHaveLength(0);
    expect(result.current.error).toBe('That item could not be used. Nothing was spent.');
  });
});
