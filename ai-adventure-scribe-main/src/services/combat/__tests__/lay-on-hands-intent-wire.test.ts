import { describe, expect, it, vi } from 'vitest';

import {
  LAY_ON_HANDS_CHOSEN_AMOUNT_INTENT_BODY,
  LAY_ON_HANDS_CURE_INTENT_BODY,
  LAY_ON_HANDS_HEAL_INTENT_BODY,
  LAY_ON_HANDS_SHEET_CURE_BODY,
  LAY_ON_HANDS_SHEET_HEAL_BODY,
} from '../../../../shared/test-fixtures/lay-on-hands-intent';
import { executeAuthoritativeCombatIntent } from '../combat-action-executor';

import { userDataApi } from '@/services/user-data-api';

const fetchSpy = vi.hoisted(() => vi.fn());
vi.mock('@/infrastructure/api/rest-client', () => ({
  fetchWithAuth: fetchSpy,
  SessionExpiredError: class extends Error {},
}));
vi.mock('@/infrastructure/api/request-id-log', () => ({ logServerRequestId: vi.fn() }));
vi.mock('@/lib/auth-gate', () => ({ waitForAuth: vi.fn(async () => undefined) }));

const okResponse = (payload: unknown) => ({
  ok: true,
  status: 200,
  headers: new Headers(),
  json: async () => payload,
});

describe('Lay on Hands wire (#1554)', () => {
  it('the heal chip sends the exact intent body the route accepts', async () => {
    fetchSpy.mockResolvedValue(okResponse({ encounter: { version: 7 } }));
    const { intent } = LAY_ON_HANDS_HEAL_INTENT_BODY;
    await executeAuthoritativeCombatIntent(
      'enc-1',
      {
        type: 'lay_on_hands',
        actorId: intent.actorId,
        targetId: intent.targetId,
        amount: intent.amount,
        expectedVersion: intent.expectedVersion,
      },
      'player',
      undefined,
      'action_bar',
    );
    const [url, init] = fetchSpy.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toContain('/v1/combat/enc-1/intent');
    expect(JSON.parse(init.body as string)).toEqual(LAY_ON_HANDS_HEAL_INTENT_BODY);
  });

  it('the cure chip sends the exact intent body with no amount', async () => {
    fetchSpy.mockResolvedValue(okResponse({ encounter: { version: 7 } }));
    const { intent } = LAY_ON_HANDS_CURE_INTENT_BODY;
    await executeAuthoritativeCombatIntent(
      'enc-1',
      {
        type: 'lay_on_hands',
        actorId: intent.actorId,
        targetId: intent.targetId,
        cure: intent.cure,
        expectedVersion: intent.expectedVersion,
      },
      'player',
      undefined,
      'action_bar',
    );
    const [, init] = fetchSpy.mock.calls.at(-1) as [string, RequestInit];
    const sent = JSON.parse(init.body as string);
    expect(sent).toEqual(LAY_ON_HANDS_CURE_INTENT_BODY);
    expect(sent.intent).not.toHaveProperty('amount');
  });

  it('the sheet heal sends the exact body the out-of-combat route accepts', async () => {
    fetchSpy.mockResolvedValue(
      okResponse({ healed: 5, poolRemaining: 10, poolMax: 15, message: 'ok' }),
    );
    await userDataApi.layOnHands('char-1', LAY_ON_HANDS_SHEET_HEAL_BODY);
    const [url, init] = fetchSpy.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toContain('/v1/characters/char-1/lay-on-hands');
    expect(JSON.parse(init.body as string)).toEqual(LAY_ON_HANDS_SHEET_HEAL_BODY);
  });

  it('the sheet cure sends the exact body the out-of-combat route accepts', async () => {
    fetchSpy.mockResolvedValue(
      okResponse({ healed: 0, poolRemaining: 10, poolMax: 15, message: 'ok' }),
    );
    await userDataApi.layOnHands('char-1', LAY_ON_HANDS_SHEET_CURE_BODY);
    const [, init] = fetchSpy.mock.calls.at(-1) as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual(LAY_ON_HANDS_SHEET_CURE_BODY);
  });
});

describe('Lay on Hands wire with a chosen amount (#1670)', () => {
  it('a heal the player stepped to 3 sends the exact shared intent body', async () => {
    fetchSpy.mockResolvedValue(okResponse({ encounter: { version: 7 } }));
    const { intent } = LAY_ON_HANDS_CHOSEN_AMOUNT_INTENT_BODY;
    await executeAuthoritativeCombatIntent(
      'enc-1',
      {
        type: 'lay_on_hands',
        actorId: intent.actorId,
        targetId: intent.targetId,
        amount: intent.amount,
        expectedVersion: intent.expectedVersion,
      },
      'player',
      undefined,
      'action_bar',
    );
    const [url, init] = fetchSpy.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toContain('/v1/combat/enc-1/intent');
    expect(JSON.parse(init.body as string)).toEqual(LAY_ON_HANDS_CHOSEN_AMOUNT_INTENT_BODY);
  });
});
