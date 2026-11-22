/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #1635 (AGENTS.md §4): the reckless attack the action bar sends must be the exact body the real intent
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
  RECKLESS_ACTOR_ID,
  RECKLESS_TARGET_ID,
  RECKLESS_WEAPON_ID,
  recklessAttackBody,
  recklessProposeBody,
} from '../../../../shared/test-fixtures/reckless-attack-intent';
import { executeStructuredCombatActionWithBoundary } from '../combat-action-executor';
import { proposeAuthoritativeAttack } from '../combat-attack-proposal';
import { askPlayerForAttackDie } from '../player-attack-roll';

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

describe('Reckless attack action bar wire body (#1635)', () => {
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

  it('posts exactly the shared reckless attack body to the intent route', async () => {
    await executeStructuredCombatActionWithBoundary('enc-1', {
      actor_id: RECKLESS_ACTOR_ID,
      action_type: 'attack',
      target_ids: [RECKLESS_TARGET_ID],
      weapon_id: RECKLESS_WEAPON_ID,
      spell_id: null,
      slot_level: null,
      movement_feet: 0,
      reckless: true,
    } as any);

    const intentCall = fetchWithAuth.mock.calls.find(([url]) =>
      String(url).endsWith('/v1/combat/enc-1/intent'),
    );
    expect(intentCall).toBeDefined();
    const { dmStartedAt, ...posted } = JSON.parse(String(intentCall?.[1]?.body));
    expect(typeof dmStartedAt).toBe('number');
    expect(posted).toEqual(recklessAttackBody());
  });

  it('proposes the reckless swing with the shared propose body before the roll', async () => {
    fetchWithAuth.mockImplementation(async () =>
      jsonResponse({ accepted: true, proposal: { legal: true, weaponName: 'Longsword' } }),
    );
    await proposeAuthoritativeAttack('enc-1', {
      type: 'attack',
      actorId: RECKLESS_ACTOR_ID,
      targetId: RECKLESS_TARGET_ID,
      weaponId: RECKLESS_WEAPON_ID,
      reckless: true,
    });
    const proposeCall = fetchWithAuth.mock.calls.find(([url]) =>
      String(url).endsWith('/v1/combat/enc-1/intent'),
    );
    expect(JSON.parse(String(proposeCall?.[1]?.body))).toEqual(recklessProposeBody());
  });

  it('the action bar chip proposes with the reckless flag, not as an ordinary attack', async () => {
    fetchWithAuth.mockImplementation(async () =>
      jsonResponse({ accepted: true, proposal: { legal: false, refusal: 'out_of_range' } }),
    );
    await askPlayerForAttackDie({
      encounterId: 'enc-1',
      action: {
        actor_id: RECKLESS_ACTOR_ID,
        action_type: 'attack',
        target_ids: [RECKLESS_TARGET_ID],
        weapon_id: RECKLESS_WEAPON_ID,
        spell_id: null,
        slot_level: null,
        movement_feet: 0,
        reckless: true,
      } as any,
      actorLabel: 'The Barbarian',
    });
    const proposeCall = fetchWithAuth.mock.calls.find(([url]) =>
      String(url).endsWith('/v1/combat/enc-1/intent'),
    );
    expect(JSON.parse(String(proposeCall?.[1]?.body)).intent).toMatchObject({ reckless: true });
  });
});
