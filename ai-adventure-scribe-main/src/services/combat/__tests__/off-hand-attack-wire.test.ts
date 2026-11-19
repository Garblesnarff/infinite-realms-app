/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #1639 (AGENTS.md §4): the off-hand attack the action bar sends must be the exact body the real intent
 * route accepts. This drives the real structured-action executor; only the HTTP call is stubbed, so the
 * POST body is what the client actually posts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fetchWithAuth } = vi.hoisted(() => ({ fetchWithAuth: vi.fn() }));

vi.mock('@/infrastructure/api/rest-client', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  fetchWithAuth,
}));

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import {
  OFF_HAND_ACTOR_ID,
  OFF_HAND_TARGET_ID,
  OFF_HAND_WEAPON_ID,
  offHandAttackBody,
} from '../../../../shared/test-fixtures/off-hand-attack-intent';
import { executeStructuredCombatActionWithBoundary } from '../combat-action-executor';

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

describe('Off-hand attack action bar wire body (#1639)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchWithAuth.mockImplementation(async (url: string) =>
      url.endsWith('/status')
        ? jsonResponse({ encounter: { version: 7 } })
        : // The intent route answers with the attack resolution under `result`, as the executor reads it.
          jsonResponse({
            result: { hit: true, targetNewHp: 493, finalDamage: 2, damageType: 'piercing' },
          }),
    );
  });

  it('posts exactly the shared off-hand attack body to the intent route', async () => {
    await executeStructuredCombatActionWithBoundary('enc-1', {
      actor_id: OFF_HAND_ACTOR_ID,
      action_type: 'attack',
      target_ids: [OFF_HAND_TARGET_ID],
      weapon_id: OFF_HAND_WEAPON_ID,
      spell_id: null,
      slot_level: null,
      movement_feet: 0,
      off_hand: true,
    } as any);

    const intentCall = fetchWithAuth.mock.calls.find(([url]) =>
      String(url).endsWith('/v1/combat/enc-1/intent'),
    );
    expect(intentCall).toBeDefined();
    const { dmStartedAt, ...posted } = JSON.parse(String(intentCall?.[1]?.body));
    expect(typeof dmStartedAt).toBe('number');
    expect(posted).toEqual(offHandAttackBody());
  });
});
