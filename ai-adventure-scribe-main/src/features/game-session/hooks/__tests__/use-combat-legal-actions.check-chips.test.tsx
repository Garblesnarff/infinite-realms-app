import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  CHECK_MENU_ACTOR_ID,
  CHECK_MENU_GIANT_ID,
  CHECK_MENU_TARGET_ID,
  combatCheckMenuIntentBody,
} from '../../../../../shared/test-fixtures/combat-check-menu-intent';
import { useCombatLegalActions } from '../use-combat-legal-actions';

import type { CombatCheckClientContext } from '@/services/combat/combat-check-client';
import type { ChatMessage } from '@/types/game';

import { runDeclaredCombatCheck } from '@/services/combat/combat-check-client';
import {
  requestPlayerAttackRoll,
  requestPlayerCheckRoll,
} from '@/services/combat/player-roll-bridge';

vi.mock('@/services/combat/player-roll-bridge', () => ({
  requestPlayerAttackRoll: vi.fn(),
  requestPlayerCheckRoll: vi.fn(),
}));

// These literals equal CHECK_MENU_ACTOR_ID / CHECK_MENU_TARGET_ID from the fixture.
const combatHolder = vi.hoisted(() => ({
  current: {
    state: {
      isInCombat: true,
      activeEncounter: {
        id: 'enc-1',
        currentTurnParticipantId: '7b1635aa-0c4e-4d2a-9a11-0000000c0001',
        currentRound: 1,
        participants: [
          { id: '7b1635aa-0c4e-4d2a-9a11-0000000c0001', participantType: 'player', name: 'Hero' },
          {
            id: '7b1635aa-0c4e-4d2a-9a11-0000000c0002',
            participantType: 'monster',
            name: 'Goblin',
          },
        ],
      },
    },
    refreshCombatState: vi.fn(),
  },
}));

vi.mock('@/contexts/CombatContext', () => ({
  useCombat: () => combatHolder.current,
  useOptionalCombat: () => combatHolder.current,
}));

describe('use-combat-legal-actions check chips (#1635)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requestPlayerCheckRoll).mockResolvedValue({
      cancelled: false,
      d20: 14,
      rollId: 'r1',
    });
    vi.mocked(requestPlayerAttackRoll).mockResolvedValue({ d20: 17, rollId: 'a1' });
  });

  function mockFetch(
    legalActions: Array<Record<string, unknown>>,
    intentStatus = 200,
    intentBody: unknown = { result: { engineLine: 'Grapple: ok' } },
  ) {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
      const path = String(url);
      if (path.includes('/legal-actions')) {
        return {
          ok: true,
          json: async () => ({ actorId: CHECK_MENU_ACTOR_ID, actions: legalActions }),
        } as Response;
      }
      if (path.includes('/intent')) {
        return {
          ok: intentStatus >= 200 && intentStatus < 300,
          status: intentStatus,
          json: async () => intentBody,
        } as Response;
      }
      if (path.includes('/status')) {
        return { ok: true, json: async () => ({ encounter: { version: 1 } }) } as Response;
      }
      throw new Error(`Unexpected request ${path}`);
    });
  }

  it('Grapple chip POSTs the shared menu intent body and never calls onSendText', async () => {
    const onSendText = vi.fn(async () => {});
    const onSendMessage = vi.fn(async (_message: ChatMessage) => {});
    mockFetch([
      {
        type: 'check',
        checkKind: 'grapple',
        targetId: CHECK_MENU_TARGET_ID,
        label: 'Grapple Goblin',
        checkModifier: 5,
      },
      {
        type: 'check',
        checkKind: 'shove',
        targetId: CHECK_MENU_TARGET_ID,
        label: 'Shove Goblin',
        checkModifier: 5,
      },
      { type: 'check', checkKind: 'hide', label: 'Hide', checkModifier: 2 },
    ]);
    const { result } = renderHook(() =>
      useCombatLegalActions({ enabled: true, onSendText, onSendMessage }),
    );
    await waitFor(() => expect(result.current.actions).toHaveLength(3));

    const grapple = result.current.actions.find((a) => a.checkKind === 'grapple')!;
    await act(async () => {
      await result.current.runAction(grapple);
    });

    const fetchSpy = vi.mocked(globalThis.fetch);
    const intentCall = fetchSpy.mock.calls.find(([url]) =>
      String(url).endsWith('/v1/combat/enc-1/intent'),
    );
    expect(intentCall).toBeDefined();
    const body = JSON.parse(String((intentCall![1] as { body?: string }).body));
    expect(body).toEqual(
      combatCheckMenuIntentBody('grapple', { targetId: CHECK_MENU_TARGET_ID, d20: 14 }),
    );
    expect(onSendText).not.toHaveBeenCalled();
  });

  it('Hide chip POSTs the shared menu intent body without targetId', async () => {
    const onSendText = vi.fn(async () => {});
    const onSendMessage = vi.fn(async (_message: ChatMessage) => {});
    mockFetch([{ type: 'check', checkKind: 'hide', label: 'Hide', checkModifier: 2 }]);
    const { result } = renderHook(() =>
      useCombatLegalActions({ enabled: true, onSendText, onSendMessage }),
    );
    await waitFor(() => expect(result.current.actions).toHaveLength(1));

    await act(async () => {
      await result.current.runAction(result.current.actions[0]);
    });

    const fetchSpy = vi.mocked(globalThis.fetch);
    const intentCall = fetchSpy.mock.calls.find(([url]) =>
      String(url).endsWith('/v1/combat/enc-1/intent'),
    );
    expect(intentCall).toBeDefined();
    const body = JSON.parse(String((intentCall![1] as { body?: string }).body));
    expect(body).toEqual(combatCheckMenuIntentBody('hide', { d20: 14 }));
    expect(onSendText).not.toHaveBeenCalled();
  });

  it('parity: runDeclaredCombatCheck sends the same body as the Grapple chip', async () => {
    mockFetch([]);
    const context: Omit<CombatCheckClientContext, 'origin'> = {
      encounterId: 'enc-1',
      actorId: CHECK_MENU_ACTOR_ID,
      actorLabel: 'Hero',
      participants: [
        { id: CHECK_MENU_ACTOR_ID, name: 'Hero', participantType: 'player' },
        { id: CHECK_MENU_TARGET_ID, name: 'Goblin', participantType: 'monster' },
      ],
      checkModifier: 5,
    };
    await runDeclaredCombatCheck('I grapple the goblin', { ...context, origin: 'typed' });

    const fetchSpy = vi.mocked(globalThis.fetch);
    const intentCall = fetchSpy.mock.calls.find(([url]) =>
      String(url).endsWith('/v1/combat/enc-1/intent'),
    );
    expect(intentCall).toBeDefined();
    const body = JSON.parse(String((intentCall![1] as { body?: string }).body)) as {
      intent: unknown;
      source: unknown;
      origin: unknown;
    };
    const expected = combatCheckMenuIntentBody('grapple', {
      targetId: CHECK_MENU_TARGET_ID,
      d20: 14,
    });
    expect(body.intent).toEqual(expected.intent);
    expect(body.source).toEqual(expected.source);
    expect(body.origin).toBe('typed');
  });

  it('refusal: hook error equals engine message, no engine notice, onSendText not called', async () => {
    const onSendText = vi.fn(async () => {});
    const onSendMessage = vi.fn(async (_message: ChatMessage) => {});
    const refusalMessage =
      'Hero (medium) cannot shove Hill Giant (huge): the target can be no more than one size larger.';
    mockFetch(
      [
        {
          type: 'check',
          checkKind: 'shove',
          targetId: CHECK_MENU_GIANT_ID,
          label: 'Shove Hill Giant',
          checkModifier: 5,
        },
      ],
      422,
      { error: refusalMessage, reason: 'check_target_too_large' },
    );
    const { result } = renderHook(() =>
      useCombatLegalActions({ enabled: true, onSendText, onSendMessage }),
    );
    await waitFor(() => expect(result.current.actions).toHaveLength(1));

    await act(async () => {
      await result.current.runAction(result.current.actions[0]);
    });

    expect(result.current.error).toBe(refusalMessage);
    expect(onSendMessage).not.toHaveBeenCalled();
    expect(onSendText).not.toHaveBeenCalled();
  });

  it('resolved Grapple chip sends one engine notice with the server engine line and refreshes', async () => {
    const onSendText = vi.fn(async () => {});
    const onSendMessage = vi.fn(async (_message: ChatMessage) => {});
    mockFetch(
      [
        {
          type: 'check',
          checkKind: 'grapple',
          targetId: CHECK_MENU_TARGET_ID,
          label: 'Grapple Goblin',
          checkModifier: 5,
        },
      ],
      200,
      { result: { engineLine: 'You grapple the Goblin.' } },
    );
    const { result } = renderHook(() =>
      useCombatLegalActions({ enabled: true, onSendText, onSendMessage }),
    );
    await waitFor(() => expect(result.current.actions).toHaveLength(1));

    await act(async () => {
      await result.current.runAction(result.current.actions[0]);
    });

    expect(onSendMessage).toHaveBeenCalledTimes(1);
    const message = onSendMessage.mock.calls[0][0];
    expect(message.text).toContain('You grapple the Goblin.');
    expect(combatHolder.current.refreshCombatState).toHaveBeenCalled();
  });

  it("a 'Shove: push 5 ft' chip POSTs shoveOutcome 'push'", async () => {
    const onSendText = vi.fn(async () => {});
    const onSendMessage = vi.fn(async (_message: ChatMessage) => {});
    mockFetch([
      {
        type: 'check',
        checkKind: 'shove',
        shoveOutcome: 'push',
        targetId: CHECK_MENU_TARGET_ID,
        label: 'Shove: push 5 ft (Goblin)',
        checkModifier: 5,
      },
    ]);
    const { result } = renderHook(() =>
      useCombatLegalActions({ enabled: true, onSendText, onSendMessage }),
    );
    await waitFor(() => expect(result.current.actions).toHaveLength(1));

    await act(async () => {
      await result.current.runAction(result.current.actions[0]);
    });

    const fetchSpy = vi.mocked(globalThis.fetch);
    const intentCall = fetchSpy.mock.calls.find(([url]) =>
      String(url).endsWith('/v1/combat/enc-1/intent'),
    );
    expect(intentCall).toBeDefined();
    const body = JSON.parse(String((intentCall![1] as { body?: string }).body));
    expect(body).toEqual(
      combatCheckMenuIntentBody('shove', {
        targetId: CHECK_MENU_TARGET_ID,
        d20: 14,
        shoveOutcome: 'push',
      }),
    );
    expect(onSendText).not.toHaveBeenCalled();
  });

  it("a 'Shove: knock prone' chip POSTs shoveOutcome 'prone'", async () => {
    const onSendText = vi.fn(async () => {});
    const onSendMessage = vi.fn(async (_message: ChatMessage) => {});
    mockFetch([
      {
        type: 'check',
        checkKind: 'shove',
        shoveOutcome: 'prone',
        targetId: CHECK_MENU_TARGET_ID,
        label: 'Shove: knock prone (Goblin)',
        checkModifier: 5,
      },
    ]);
    const { result } = renderHook(() =>
      useCombatLegalActions({ enabled: true, onSendText, onSendMessage }),
    );
    await waitFor(() => expect(result.current.actions).toHaveLength(1));

    await act(async () => {
      await result.current.runAction(result.current.actions[0]);
    });

    const fetchSpy = vi.mocked(globalThis.fetch);
    const intentCall = fetchSpy.mock.calls.find(([url]) =>
      String(url).endsWith('/v1/combat/enc-1/intent'),
    );
    expect(intentCall).toBeDefined();
    const body = JSON.parse(String((intentCall![1] as { body?: string }).body));
    expect(body).toEqual(
      combatCheckMenuIntentBody('shove', {
        targetId: CHECK_MENU_TARGET_ID,
        d20: 14,
        shoveOutcome: 'prone',
      }),
    );
    expect(onSendText).not.toHaveBeenCalled();
  });

  it('dismissed roll popup sends no /intent POST, sets no error, and calls no notice senders', async () => {
    const onSendText = vi.fn(async () => {});
    const onSendMessage = vi.fn(async (_message: ChatMessage) => {});
    vi.mocked(requestPlayerCheckRoll).mockResolvedValueOnce({
      cancelled: true,
      d20: null,
      rollId: 'r1',
    });
    mockFetch([
      {
        type: 'check',
        checkKind: 'grapple',
        targetId: CHECK_MENU_TARGET_ID,
        label: 'Grapple Goblin',
        checkModifier: 5,
      },
    ]);
    const { result } = renderHook(() =>
      useCombatLegalActions({ enabled: true, onSendText, onSendMessage }),
    );
    await waitFor(() => expect(result.current.actions).toHaveLength(1));

    const fetchSpy = vi.mocked(globalThis.fetch);
    const before = fetchSpy.mock.calls.filter(([url]) =>
      String(url).endsWith('/v1/combat/enc-1/intent'),
    ).length;
    await act(async () => {
      await result.current.runAction(result.current.actions[0]);
    });
    const after = fetchSpy.mock.calls.filter(([url]) =>
      String(url).endsWith('/v1/combat/enc-1/intent'),
    ).length;

    expect(after).toBe(before);
    expect(result.current.error).toBeNull();
    expect(onSendText).not.toHaveBeenCalled();
    expect(onSendMessage).not.toHaveBeenCalled();
  });
});
